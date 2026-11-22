"""QEC-Aegis v2: an operating point per noise setting, chosen on validation shots. Nothing is refit.

  python -m aegis.retune            choose, write models/v2/ and freeze their hashes

v1 (models/*.joblib, frozen before the seed-2 test shots were decoded) used one threshold and one
second tier for all three p. Its test results showed the speedup collapsing at p = 0.005 and an
erasure threshold that had never been validated. Those results motivated v2, so v2 is scored on
fresh shots (splits test2 and timing2, seeds 7 and 8) that nothing here has seen.

v2 keeps v1's fitted risk models (trained on seed 1, Platt-calibrated on seed 4) and, for each
setting separately, on validation shots only (seed 3), picks the second tier and the threshold:

  candidates  tier 1 relay1 (as v1), tier 2 in {relay, strong10}, threshold in aegis.train.THRESHOLDS
  speed       fastest mean pair time with no more failed pairs than relay-BP at that setting
  accuracy    fewest failed pairs with a mean pair time no higher than relay-BP's (ties: faster)

Erasure settings (p = 0.004, f = 0.25, 0.5, 0.75) do the same with the +flags tiers, the erasure
risk model and flag-aware relay-BP as the reference. The model overhead in every decode time is the
measured per-shot time of the compiled risk model (aegis.model.CompiledTrees).

A routed decoder is configured for the setting it runs at, as the priors of every decoder here
already are. Writes models/v2/aegis_<mode>_p<p>[_f<f>].joblib, results/v2_selection.json
and results/v2_frozen.json (file hashes, recorded before any test2/timing2 decoding).
"""
import copy
import hashlib
import json
import subprocess
import time

import joblib
import numpy as np

from .collect import RECORDS, load
from .paths import MODELS, REPORTS, ROOT
from .policy import frontier, pair_failures, pair_seconds
from .train import SWEEP, THRESHOLDS, inference_seconds

V2 = MODELS / "v2"
SETTINGS = [(p, 0.0) for p in SWEEP] + [(0.004, f) for f in (0.25, 0.5, 0.75)]
MODES = ("speed", "accuracy")


def setting_name(p, f):
    return f"p{p}" + (f"_f{f}" if f else "")


def model_file(mode, p, f):
    return V2 / f"aegis_{mode}_{setting_name(p, f)}.joblib"


def choose(x, z, model, overhead, flags=""):
    """Speed and accuracy operating points of one setting on its validation records."""
    tier1, reference = "relay1" + flags, "relay" + flags
    ref_fail = int(pair_failures(x[reference]["failed"], z[reference]["failed"]).sum())
    ref_ms = float(pair_seconds(x[reference]["seconds"], z[reference]["seconds"]).mean() * 1e3)
    risks = [model.risks(r[tier1]["features"]) for r in (x, z)]
    candidates = []
    for tier2 in ("relay" + flags, "strong10" + flags):
        if tier2 not in x or tier2 not in z:
            continue
        for k, point in enumerate(frontier(x, z, risks[0], risks[1], THRESHOLDS, tier1, tier2, overhead)):
            candidates.append(point | {"tier2": tier2, "order": k})
    speed = [c for c in candidates if c["failures_pair"] <= ref_fail]
    accuracy = [c for c in candidates if c["ms_mean"] <= ref_ms]
    chosen = {"speed": min(speed, key=lambda c: (c["ms_mean"], c["failures_pair"])) if speed else None,
              "accuracy": min(accuracy, key=lambda c: (c["failures_pair"], c["ms_mean"])) if accuracy else None}
    return chosen, {"relay_failures": ref_fail, "relay_ms": ref_ms, "pairs": len(x["observables"]), "candidates": len(candidates)}


def main():
    V2.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    base = {0.0: joblib.load(MODELS / "aegis_router.joblib"), "loss": joblib.load(MODELS / "aegis_router_loss.joblib")}
    report = {"rule": {"speed": "fastest mean with failed pairs <= relay-BP at the setting",
                       "accuracy": "fewest failed pairs with mean <= relay-BP at the setting"},
              "split": "val (seed 3)", "settings": {}}
    hashes = {}
    for p, f in SETTINGS:
        flags = "+flags" if f else ""
        paths = [RECORDS / f"val_{b}_{setting_name(p, f)}.npz" for b in "XZ"]
        if not all(path.exists() for path in paths):
            raise SystemExit(f"missing validation records for p={p} f={f}: decode them first (see the module docstring)")
        x, z = (load(path) for path in paths)
        model = base["loss" if f else 0.0]
        overhead = inference_seconds(model, x["relay1" + flags]["features"])
        chosen, reference = choose(x, z, model, overhead, flags)
        key = setting_name(p, f)
        report["settings"][key] = reference | {"inference_us": overhead * 1e6, "chosen": chosen}
        for mode in MODES:
            c = chosen[mode]
            if c is None:
                print(f"{key} {mode}: no operating point satisfies the rule")
                continue
            v2 = copy.deepcopy(model)
            v2.meta = model.meta | {"tier1": "relay1" + flags, "tier2": c["tier2"], "threshold": c["threshold"], "mode": mode,
                                    "version": 2, "setting": {"p": p, "f": f}, "inference_seconds": overhead,
                                    "selected_on": "val seed 3", "threshold_from": "aegis.retune"}
            path = model_file(mode, p, f)
            joblib.dump(v2, path)
            hashes[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
            print(f"{key:12s} {mode:8s} tier2 {c['tier2']:15s} thr {c['threshold']:.2e}: {c['failures_pair']:4d} failed pairs "
                  f"(relay-BP {reference['relay_failures']}), {c['ms_mean']:7.1f} ms (relay-BP {reference['relay_ms']:.1f}), "
                  f"tier 2 on {100 * c['escalated']:.2f}%")
    (REPORTS / "v2_selection.json").write_text(json.dumps(report, indent=1))
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    (REPORTS / "v2_frozen.json").write_text(json.dumps({
        "frozen_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "commit_before_freeze": commit,
        "note": "Written by aegis.retune before any test2 (seed 7) or timing2 (seed 8) shot was decoded. "
                "aegis.collect --model loads these files; their hashes must not change before the v2 report.",
        "models": hashes}, indent=1))
    print("wrote", REPORTS / "v2_selection.json", "and", REPORTS / "v2_frozen.json")


if __name__ == "__main__":
    main()
