"""Build a TEST FIXTURE with exactly the schema of experiments/reports/evaluation.json.

  OMP_NUM_THREADS=1 .venv/bin/python lab/e2e/make_fixture.py      (from the repository root)

It runs aegis.evaluate.evaluate_setting on the *validation* records, so every field has the real
type and shape. It is NOT a result: the file says so in its "fixture" field, and the lab never
reads it. The browser tests inject it to exercise the completed-evaluation view before the frozen
test pipeline has run.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from aegis.evaluate import load_systems, evaluate_setting, record_pair  # noqa: E402

systems = load_systems()
report = {"fixture": "validation-shaped test fixture for the browser tests; not a measurement of the frozen test set",
          "model": {k: v for k, v in systems["aegis"].meta.items() if k != "feature_names"}, "sweep": {}, "timing": {}, "loss": {}}
for p in (0.003, 0.004, 0.005):
    pair = record_pair("val", p)
    result = evaluate_setting(*pair, systems)
    result["decoders"]["aegis (online)"] = dict(result["decoders"]["aegis"], escalated_fraction=result["decoders"]["aegis"]["escalated_fraction"])
    report["sweep"][str(p)] = result
    timing = evaluate_setting(*pair, systems, timing=True)
    report["timing"][str(p)] = timing
for f in ("0.25", "0.5", "0.75"):
    loss = json.loads(json.dumps(report["sweep"]["0.004"]))
    loss["decoders"]["bposd (flags ignored)"] = loss["decoders"].pop("bposd")
    loss["decoders"]["relay (flags ignored)"] = loss["decoders"].pop("relay")
    loss.pop("frontier", None); loss.pop("pareto", None)
    report["loss"][f] = loss
out = ROOT / "lab" / "e2e" / "fixtures" / "evaluation.fixture.json"
out.write_text(json.dumps(report))
print("wrote", out, out.stat().st_size, "bytes")
