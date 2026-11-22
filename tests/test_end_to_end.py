"""The whole pipeline offline, on a small scale: generate -> label -> featurize -> train ->
calibrate -> select -> evaluate, then the routed decoder online on the same test shots.

Runs in a temporary directory with no network access and takes a few minutes.
"""
import json
import sys

import joblib
import pytest

from aegis import collect, evaluate, train
from aegis.decoder import AegisDecoder
from aegis.problem import Problem

P = 0.006   # noisier than the challenge sweep, so that a few hundred shots contain wrong tier-1 answers


@pytest.fixture(scope="module")
def workspace(tmp_path_factory):
    root = tmp_path_factory.mktemp("pipeline")
    patch = pytest.MonkeyPatch()
    for module in (collect, train, evaluate):
        patch.setattr(module, "RECORDS", root / "records")
    patch.setattr(collect, "TRAIN_RECORDS", root / "train")
    patch.setattr(train, "TRAIN_RECORDS", root / "train")
    patch.setattr(collect, "DATA", root / "data")
    for module in (collect, evaluate):
        patch.setattr(module, "MANIFEST", root / "manifest.json")
    for module in (train, evaluate):
        patch.setattr(module, "MODELS", root / "models")
        patch.setattr(module, "REPORTS", root / "reports")
    patch.setattr(train, "TIER1", ["fast"])
    patch.setattr(train, "TIER2", ["relay"])
    patch.setattr(evaluate, "SWEEP", [P])
    yield root
    patch.undo()


def test_pipeline_end_to_end(workspace, monkeypatch, capsys):
    quiet = lambda *_: None
    for basis in "XZ":
        collect.collect("train", basis, P, 0.0, 500, ["fast"], workers=4, chunk=125, log=quiet)
        collect.collect("calib", basis, P, 0.0, 250, ["fast"], workers=4, chunk=63, log=quiet)
        collect.collect("val", basis, P, 0.0, 24, ["fast", "relay"], workers=4, chunk=6, log=quiet)
        collect.collect("test", basis, P, 0.0, 16, ["fast", "relay", "bposd"], workers=4, chunk=4, log=quiet)

    monkeypatch.setattr(sys, "argv", ["train", "--p", str(P)])
    train.main()
    report = json.loads((workspace / "reports" / "training.json").read_text())
    assert "speed" in report["chosen"] and report["chosen"]["speed"]["tier1"] == "fast"
    model = joblib.load(workspace / "models" / "aegis_router.joblib")
    assert model.meta["tier2"] == "relay" and 0 <= model.meta["threshold"] <= 1

    # The routed decoder, online, on the test shots: added to the same record files.
    for basis in "XZ":
        collect.collect("test", basis, P, 0.0, 16, ["aegis"], workers=2, chunk=4,
                        model_path=str(workspace / "models" / "aegis_router.joblib"), log=quiet)
    monkeypatch.setattr(sys, "argv", ["evaluate", "--fractions"])
    evaluate.main()
    result = json.loads((workspace / "reports" / "evaluation.json").read_text())["sweep"][str(P)]
    assert {"bposd", "relay", "tier 1 alone", "rule (no ML)", "aegis", "aegis (online)"} <= set(result["decoders"])
    # Same chunk size, so tier 1 decoded identically and every routing decision is the same.
    # Tier 2 is randomized, so the outcomes agree on most shots, not necessarily on all.
    assert result["online_agrees_with_cached"]["decisions"] == 1.0
    assert result["online_agrees_with_cached"]["failures"] >= 0.75
    online = result["decoders"]["aegis (online)"]
    assert online["pairs"] == 16 and online["ms_mean"] > 0 and 0 <= online["ler"] < 1
    assert result["decoders"]["aegis"]["failures_pair"] <= result["decoders"]["tier 1 alone"]["failures_pair"]
    assert len(json.loads((workspace / "manifest.json").read_text())) == 10   # 8 collections + 2 online runs

    # And one shot through the decoder object itself.
    problem = Problem("X", P)
    syndromes, other, _, fired = problem.sample(1, seed=2)
    out = AegisDecoder(problem, model).decode_shot(syndromes[0], int(other[0].sum()), fired[0])
    assert out.error.shape == (problem.H.shape[1],) and 0 <= out.risk <= 1
