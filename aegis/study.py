"""Which decoders complement each other? Read from validation records, never from test records.

  python -m aegis.study --p 0.004

Prints and saves (experiments/reports/complementarity_p<p>.json):
  1. the paired outcome table of BP-OSD and relay-BP with the decode time in each cell,
  2. what an ideal router between the two could gain,
  3. every tier on its own,
  4. rule-based two-tier decoders: run a first stage, escalate when it did not converge,
  5. how many wrong answers each first stage hides behind a converged result. Only those
     need a learned router.
"""
import argparse
import json

import numpy as np

from mgccorrection.paths import ROOT

from .collect import RECORDS, load
from .policy import per_cycle, route

REPORTS = ROOT / "experiments" / "reports"
FIRST_STAGES = ["bp30", "bp200", "fast0", "fast", "relay1"]
SECOND_STAGES = ["relay", "strong10", "strong"]


def pair(x, z, name, field="failed"):
    return x[name][field], z[name][field]


def paired_outcomes(x, z, a="bposd", b="relay"):
    """Counts and mean decode times (ms per shot, both bases pooled) of the four outcome cells."""
    cells = {}
    fa = np.concatenate(pair(x, z, a))
    fb = np.concatenate(pair(x, z, b))
    ta = np.concatenate(pair(x, z, a, "seconds")) * 1e3
    tb = np.concatenate(pair(x, z, b, "seconds")) * 1e3
    for label, mask in [("both correct", ~fa & ~fb), (f"{a} correct, {b} wrong", ~fa & fb),
                        (f"{b} correct, {a} wrong", fa & ~fb), ("both wrong", fa & fb)]:
        cells[label] = {"shots": int(mask.sum()), f"{a}_ms": float(ta[mask].mean()) if mask.any() else None,
                        f"{b}_ms": float(tb[mask].mean()) if mask.any() else None}
    return cells


def study(p, split="val"):
    x, z = load(RECORDS / f"{split}_X_p{p}.npz"), load(RECORDS / f"{split}_Z_p{p}.npz")
    tiers = [t for t in x if isinstance(x[t], dict) and t in z]
    n = len(x["observables"])
    report = {"p": p, "split": split, "pairs": n, "paired_outcomes_bposd_relay": paired_outcomes(x, z)}

    def line(fx, fz, sx, sz, extra=None):
        failures = int((fx | fz).sum())
        return {"failures_X": int(fx.sum()), "failures_Z": int(fz.sum()), "failures_pair": failures,
                "ler": float(per_cycle(failures / n)), "ms_mean": float((sx + sz).mean() * 1e3),
                "ms_p99": float(np.percentile((sx + sz) * 1e3, 99))} | (extra or {})

    report["tiers"] = {t: line(*pair(x, z, t), *pair(x, z, t, "seconds"),
                               {"unconverged": float((~x[t]["converged"]).mean() / 2 + (~z[t]["converged"]).mean() / 2)})
                       for t in tiers}

    # An ideal router between BP-OSD and relay-BP knows which one is right.
    oracle = [x["bposd"]["failed"] & x["relay"]["failed"], z["bposd"]["failed"] & z["relay"]["failed"]]
    # A realizable one keeps the lighter of the two answers and pays for both decoders.
    lighter = [np.where(r["bposd"]["weight"] < r["relay"]["weight"], r["bposd"]["failed"], r["relay"]["failed"]) for r in (x, z)]
    both = [r["bposd"]["seconds"] + r["relay"]["seconds"] for r in (x, z)]
    report["bposd_relay_routing"] = {"oracle": line(*oracle, *both), "lighter_answer": line(*lighter, *both)}

    report["rule_based"], report["hidden_failures"] = {}, {}
    for first in FIRST_STAGES:
        if first not in tiers:
            continue
        hidden = [r[first]["failed"] & r[first]["converged"] for r in (x, z)]
        report["hidden_failures"][first] = {
            "converged_but_wrong": int(hidden[0].sum() + hidden[1].sum()),
            "converged": int(x[first]["converged"].sum() + z[first]["converged"].sum()), "shots": 2 * n}
        for second in SECOND_STAGES:
            if second not in tiers:
                continue
            never = np.zeros(n, bool)
            rx, rz = route(x[first], x[second], never), route(z[first], z[second], never)
            report["rule_based"][f"{first} -> {second}"] = line(rx[0], rz[0], rx[1], rz[1],
                                                                 {"escalated": float((rx[2].mean() + rz[2].mean()) / 2)})
            # The same pair with a perfect router: escalate exactly the wrong first-stage answers.
            ox, oz = route(x[first], x[second], x[first]["failed"]), route(z[first], z[second], z[first]["failed"])
            report["rule_based"][f"{first} -> {second} (perfect router)"] = line(
                ox[0], oz[0], ox[1], oz[1], {"escalated": float((ox[2].mean() + oz[2].mean()) / 2)})
    return report


def show(report):
    print(f"\n=== p = {report['p']}, {report['pairs']} shot pairs ({report['split']}) ===")
    print("BP-OSD vs relay-BP, per shot (both bases):")
    for label, cell in report["paired_outcomes_bposd_relay"].items():
        times = "  ".join(f"{k} {v:.0f}" for k, v in cell.items() if k != "shots" and v is not None)
        print(f"  {label:28s} {cell['shots']:6d}   {times}")
    for title, key in [("Single tiers", "tiers"), ("BP-OSD / relay-BP routing", "bposd_relay_routing"), ("Two tiers", "rule_based")]:
        print(f"{title}:")
        for name, r in report[key].items():
            extra = f"  escalated {100 * r['escalated']:.1f}%" if "escalated" in r else ""
            print(f"  {name:38s} [{r['failures_X']:4d} {r['failures_Z']:4d}] pair {r['failures_pair']:4d}  "
                  f"LER {r['ler']:.2e}  mean {r['ms_mean']:7.1f} ms  p99 {r['ms_p99']:6.0f}{extra}")
    print("Wrong answers hidden behind a converged first stage:")
    for name, r in report["hidden_failures"].items():
        print(f"  {name:8s} {r['converged_but_wrong']:5d} of {r['converged']} converged shots")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--p", type=float, nargs="+", default=[0.003, 0.004, 0.005])
    parser.add_argument("--split", default="val")
    args = parser.parse_args()
    REPORTS.mkdir(parents=True, exist_ok=True)
    for p in args.p:
        report = study(p, args.split)
        show(report)
        (REPORTS / f"complementarity_p{p}.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
