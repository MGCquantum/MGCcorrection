"""Re-score the frozen routers on validation shots under the current X/Z pairing. Nothing is refit.

  python -m aegis.recheck

The models in models/ were chosen by aegis.train and frozen (experiments/reports/frozen_models.json)
before any test shot was decoded. That selection paired X shot k with Z shot k. Same-seed X and Z
records share Stim's random stream, so those pairs were correlated; the kit's analyze.py, and now
aegis.policy, pair X shot k with Z shot analyze.z_partner(n)[k] instead.

This module keeps every frozen model and threshold, recomputes the validation pair failures and
mean times with the corrected pairing, and reports whether each mode still satisfies the rule it was
selected by (see aegis.train):

  speed      no more validation pair failures than relay-BP at every p
  accuracy   no slower than relay-BP on average at every p
  heuristic  as speed

Only validation records (seed 3) are read. Writes experiments/reports/validation_recheck.json.
"""
import json

import joblib

from .collect import load
from .paths import MODELS, RECORDS, REPORTS
from .policy import frontier, pair_failures, pair_seconds
from .train import SWEEP, name_of

MODES = {"speed": "aegis_router.joblib", "accuracy": "aegis_router_accuracy.joblib", "heuristic": "heuristic_router.joblib"}


def recheck(mode, model, settings=tuple((p, 0.0) for p in SWEEP)):
    """Validation result of one frozen router at its frozen threshold, next to relay-BP."""
    meta = model.meta
    tier1, tier2, threshold = meta["tier1"], meta["tier2"], meta["threshold"]
    per_setting = {}
    for p, f in settings:
        x, z = (load(RECORDS / name_of("val", basis, p, f)) for basis in "XZ")
        point, = frontier(x, z, model.risks(x[tier1]["features"]), model.risks(z[tier1]["features"]), [threshold],
                          tier1, tier2, meta["inference_seconds"])
        per_setting[f"p={p} f={f}"] = point | {
            "relay_failures": int(pair_failures(x["relay"]["failed"], z["relay"]["failed"]).sum()),
            "relay_ms": float(pair_seconds(x["relay"]["seconds"], z["relay"]["seconds"]).mean() * 1e3),
            "pairs": len(x["observables"])}
    no_worse = all(s["failures_pair"] <= s["relay_failures"] for s in per_setting.values())
    no_slower = all(s["ms_mean"] <= s["relay_ms"] for s in per_setting.values())
    return {"file": MODES[mode], "tier1": tier1, "tier2": tier2, "model": meta["name"], "threshold": threshold,
            "failures": int(sum(s["failures_pair"] for s in per_setting.values())),
            "relay_failures": int(sum(s["relay_failures"] for s in per_setting.values())),
            "mean_ms": float(sum(s["ms_mean"] for s in per_setting.values()) / len(per_setting)),
            "rule": "no slower than relay-BP at every p" if mode == "accuracy" else "no more failures than relay-BP at every p",
            "rule_holds": bool(no_slower if mode == "accuracy" else no_worse),
            "per_setting": per_setting}


def main():
    out = {"split": "validation", "pairing": "analyze.z_partner (independent X/Z pairs)",
           "note": "Frozen models and thresholds, unchanged; only the pairing of validation shots differs from selection time.",
           "modes": {}}
    for mode, file in MODES.items():
        path = MODELS / file
        if not path.exists():
            continue
        result = recheck(mode, joblib.load(path))
        out["modes"][mode] = result
        print(f"{mode:9s} {result['tier1']} -> {result['tier2']} thr {result['threshold']:.2e}: "
              f"{result['failures']} validation pair failures (relay-BP {result['relay_failures']}), "
              f"{result['mean_ms']:.0f} ms mean; rule '{result['rule']}' holds: {result['rule_holds']}")
        for setting, s in result["per_setting"].items():
            print(f"    {setting}: {s['failures_pair']} vs relay {s['relay_failures']}, {s['ms_mean']:.1f} vs {s['relay_ms']:.1f} ms")
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "validation_recheck.json").write_text(json.dumps(out, indent=1))
    print("wrote", REPORTS / "validation_recheck.json")


if __name__ == "__main__":
    main()
