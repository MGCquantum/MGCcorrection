"""Score QEC-Aegis v2, v1 and both baselines on fresh shots that no selection step has seen.

  python -m aegis.evaluate_v2

Reads data/test2_* (seed 7; 8 parallel workers) and timing2_* (seed 8; one worker,
nothing else running). Every decoder at one setting decoded the same shots and is scored on the
same X/Z pairs (analyze.z_partner), with the conventions of aegis.policy. Rows:

  bposd, relay (+flags under erasure)   the kit's baselines
  aegis v1 (online)                     the frozen v1 routed decoder, replicated on fresh shots
  aegis v2 speed / accuracy (online)    the operating points chosen by aegis.retune on validation

Writes results/v2_evaluation.json.
"""
import csv
import json

from .collect import RECORDS, load
from .policy import compare, pair_failures, pair_seconds, summarize
from .train import REPORTS, SWEEP

FRACTIONS = (0.25, 0.5, 0.75)
ONLINE = {"aegis-v1": "aegis v1 (online)", "aegis2-speed": "aegis v2 speed (online)", "aegis2-accuracy": "aegis v2 accuracy (online)"}


def pair(split, p, f=0.0):
    name = f"p{p}" + (f"_f{f}" if f else "")
    paths = [RECORDS / f"{split}_{basis}_{name}.npz" for basis in "XZ"]
    return [load(path) for path in paths] if all(path.exists() for path in paths) else None


def evaluate(x, z, flags=""):
    rows, pairs, times = {}, {}, {}
    for tier in ("bposd" + flags, "relay" + flags):
        if tier in x and tier in z:
            rows[tier] = summarize(x[tier]["failed"], z[tier]["failed"], x[tier]["seconds"], z[tier]["seconds"])
            pairs[tier], times[tier] = pair_failures(x[tier]["failed"], z[tier]["failed"]), pair_seconds(x[tier]["seconds"], z[tier]["seconds"]) * 1e3
    for tier, label in ONLINE.items():
        tier += flags
        if tier not in x or tier not in z:
            continue
        rows[label] = summarize(x[tier]["failed"], z[tier]["failed"], x[tier]["seconds"], z[tier]["seconds"]) | {
            "escalated_fraction": float((x[tier]["escalated"].mean() + z[tier]["escalated"].mean()) / 2),
            "ms_model_mean": float((x[tier]["seconds_model"] + z[tier]["seconds_model"]).mean() * 1e3)}
        pairs[label], times[label] = pair_failures(x[tier]["failed"], z[tier]["failed"]), pair_seconds(x[tier]["seconds"], z[tier]["seconds"]) * 1e3
    comparisons = {}
    for label in ONLINE.values():
        if label not in rows:
            continue
        for base in ("relay" + flags, "bposd" + flags):
            if base in rows:
                comparisons[f"{label} vs {base}"] = compare(pairs[label], pairs[base], times[label], times[base])
    if ONLINE["aegis-v1"] in rows:
        for label in list(ONLINE.values())[1:]:
            if label in rows:
                comparisons[f"{label} vs {ONLINE['aegis-v1']}"] = compare(pairs[label], pairs[ONLINE["aegis-v1"]], times[label], times[ONLINE["aegis-v1"]])
    return {"decoders": rows, "comparisons": comparisons}


def show(title, result):
    print(f"\n=== {title} ===")
    for name, r in result["decoders"].items():
        esc = f"  tier 2 {100 * r['escalated_fraction']:.2f}%" if "escalated_fraction" in r else ""
        print(f"  {name:28s} pair {r['failures_pair']:5d} / {r['pairs']:,}  LER {r['ler']:.2e} [{r['ler_ci95'][0]:.1e}, {r['ler_ci95'][1]:.1e}]  "
              f"mean {r['ms_mean']:7.1f}  med {r['ms_median']:6.1f}  p99 {r['ms_p99']:7.0f} ms{esc}")
    for name, c in result["comparisons"].items():
        ratio = "n/a" if c["ler_ratio"] is None else f"{c['ler_ratio']:.2f} [{c['ler_ratio_ci95'][0]:.2f}, {c['ler_ratio_ci95'][1]:.2f}]"
        print(f"  {name:52s} LER ratio {ratio}  McNemar p {c['mcnemar_p']:.3g}  speedup {c['speedup_mean']:.2f}x "
              f"[{c['speedup_mean_ci95'][0]:.2f}, {c['speedup_mean_ci95'][1]:.2f}]")


def main():
    report = {"sweep": {}, "timing": {}, "loss": {},
              "splits": {"test2": "seed 7, 8 parallel workers", "timing2": "seed 8, one worker, nothing else running"}}
    for split, key in (("test2", "sweep"), ("timing2", "timing")):
        for p in SWEEP:
            records = pair(split, p)
            if records:
                report[key][str(p)] = evaluate(*records)
                show(f"{split} p = {p}", report[key][str(p)])
    for f in FRACTIONS:
        records = pair("test2", 0.004, f)
        if records:
            report["loss"][str(f)] = evaluate(*records, flags="+flags")
            show(f"test2 p = 0.004, erasure fraction {f}", report["loss"][str(f)])
    selection = REPORTS / "v2_selection.json"
    if selection.exists():
        report["selection"] = json.loads(selection.read_text())
    (REPORTS / "v2_evaluation.json").write_text(json.dumps(report, indent=1, default=float))
    write_csv(report)
    print("\nwrote", REPORTS / "v2_evaluation.json", "and", REPORTS / "v2_summary.csv")


def write_csv(report):
    """One row per (p, decoder): error rate from the test shots, latency from the single-worker timing shots."""
    header = ["p", "decoder", "test_pairs", "failed_pairs", "ler_per_cycle", "ler_ci95_low", "ler_ci95_high",
              "timing_pairs", "ms_mean", "ms_mean_ci95_low", "ms_mean_ci95_high", "ms_median", "ms_p95", "ms_p99", "tier2_fraction"]
    with open(REPORTS / "v2_summary.csv", "w", newline="") as handle:
        out = csv.writer(handle)
        out.writerow(header)
        for p, sweep in report["sweep"].items():
            timing = report["timing"].get(p, {"decoders": {}})["decoders"]
            for name, d in sweep["decoders"].items():
                t = timing.get(name)
                lat = [t["pairs"], *(round(t[k], 3) for k in ("ms_mean",)), *(round(v, 3) for v in t["ms_mean_ci95"]),
                       *(round(t[k], 3) for k in ("ms_median", "ms_p95", "ms_p99"))] if t else [""] * 7
                out.writerow([p, name.replace(" (online)", ""), d["pairs"], d["failures_pair"], f"{d['ler']:.4e}",
                              f"{d['ler_ci95'][0]:.4e}", f"{d['ler_ci95'][1]:.4e}", *lat,
                              f"{d['escalated_fraction']:.4f}" if "escalated_fraction" in d else ""])


if __name__ == "__main__":
    main()
