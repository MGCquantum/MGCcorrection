"""Score every decoder and routing policy on the frozen test records.

  python -m aegis.evaluate

Reads experiments/records/test_*.npz (seed 2) and the model chosen by aegis.train. Nothing is
tuned here: the model, its threshold and the tier pair were fixed on validation data.
Writes experiments/reports/evaluation.json and prints the tables.

Decoders per noise strength:
  bposd, relay            the kit's baselines
  tier 1 alone            early-stopping relay-BP, no second tier
  bp200 -> relay (rule)   the team's hybrid_rule: plain BP, relay-BP when it does not converge
  rule (no ML)            tier 1, tier 2 only when tier 1 does not converge
  heuristic               tier 2 also when one hand-picked feature crosses its threshold
  aegis                   tier 2 also when the learned risk crosses its threshold
  aegis (online)          the same decoder run as one program, when that record exists
  oracle router           tier 2 exactly when tier 1 is wrong: uses the truth, an unattainable bound
Times of cached policies are sums of measured per-stage times plus the measured model time.
"""
import argparse
import json

import joblib
import numpy as np

from .collect import MANIFEST, RECORDS, load
from .model import quality
from .policy import compare, frontier, oracle_route, pair_failures, pair_seconds, pareto, route, summarize
from .train import MODELS, REPORTS, THRESHOLDS

SWEEP = [0.003, 0.004, 0.005]
ORACLE = "oracle router (knows the truth; unattainable)"


def record_pair(split, p, f=0.0):
    name = f"p{p}" + (f"_f{f}" if f else "")
    paths = [RECORDS / f"{split}_{basis}_{name}.npz" for basis in "XZ"]
    return [load(path) for path in paths] if all(path.exists() for path in paths) else None


def routed(x, z, model, threshold, tier1, tier2, overhead):
    """Per-basis (failed, seconds, escalated, risk) of threshold routing on cached records."""
    out = []
    for r in (x, z):
        risk = model.risks(r[tier1]["features"]) if model is not None else np.zeros(len(r["observables"]))
        out.append(route(r[tier1], r[tier2], risk >= threshold, overhead) + (risk,))
    return out


def diagnostics(x, z, parts, tier1, tier2):
    """What the router did, pooled over both bases."""
    d = {key: 0 for key in ("shots", "escalated", "unconverged", "flagged_by_model", "tier1_wrong", "tier1_wrong_escalated",
                            "hidden_failures", "hidden_failures_caught", "fixed_by_tier2", "broken_by_tier2", "needless")}
    for r, (failed, _, escalated, risk) in zip((x, z), parts):
        first = r[tier1]
        hidden = first["failed"] & first["converged"]
        d["shots"] += len(failed)
        d["escalated"] += int(escalated.sum())
        d["unconverged"] += int((~first["converged"]).sum())
        d["flagged_by_model"] += int((escalated & first["converged"]).sum())
        d["tier1_wrong"] += int(first["failed"].sum())
        d["tier1_wrong_escalated"] += int((first["failed"] & escalated).sum())
        d["hidden_failures"] += int(hidden.sum())
        d["hidden_failures_caught"] += int((hidden & escalated).sum())
        d["fixed_by_tier2"] += int((first["failed"] & ~failed).sum())
        d["broken_by_tier2"] += int((~first["failed"] & failed).sum())
        d["needless"] += int((escalated & first["converged"] & ~first["failed"]).sum())
    d["escalated_fraction"] = d["escalated"] / d["shots"]
    return d


def evaluate_setting(x, z, systems, timing=False):
    """All decoders and comparisons for one noise setting. x and z are record dicts.

    systems: {"aegis": model, "heuristic": model, ...}. Each model's meta names its tiers and
    threshold. "aegis" is the primary system; the no-ML rule uses its tiers.
    """
    model = systems["aegis"]
    tier1, tier2 = model.meta["tier1"], model.meta["tier2"]
    rows, pairs, times, out = {}, {}, {}, {}

    def add(name, fx, fz, sx, sz, **extra):
        rows[name] = summarize(fx, fz, sx, sz) | extra
        pairs[name], times[name] = pair_failures(fx, fz), pair_seconds(sx, sz) * 1e3

    for tier, label in [("bposd", "bposd"), ("relay", "relay"), ("bposd+flags", "bposd+flags"), ("relay+flags", "relay+flags"),
                        (tier1, "tier 1 alone"), (tier2, "tier 2 alone")]:
        if tier in x and tier in z and label not in rows:
            add(label, x[tier]["failed"], z[tier]["failed"], x[tier]["seconds"], z[tier]["seconds"])
    if "bp200" in x and "relay" in x:
        parts = routed(x, z, None, 2.0, "bp200", "relay", 0.0)
        add("bp200 -> relay (rule)", parts[0][0], parts[1][0], parts[0][1], parts[1][1],
            escalated_fraction=float((parts[0][2].mean() + parts[1][2].mean()) / 2))
    # Timing records hold only bposd, relay and the online decoder: the cached tiers are absent there.
    cached_tiers = tier1 in x and tier2 in x and tier1 in z and tier2 in z
    if cached_tiers:
        parts = routed(x, z, None, 2.0, tier1, tier2, 0.0)
        add("rule (no ML)", parts[0][0], parts[1][0], parts[0][1], parts[1][1], **diagnostics(x, z, parts, tier1, tier2))
    if cached_tiers:
        parts = [oracle_route(r[tier1], r[tier2]) + (None,) for r in (x, z)]
        add(ORACLE, parts[0][0], parts[1][0], parts[0][1], parts[1][1], unattainable=True,
            escalated_fraction=float((parts[0][2].mean() + parts[1][2].mean()) / 2), tiers=f"{tier1} -> {tier2}")
    for name, m in systems.items():
        t1, t2 = m.meta["tier1"], m.meta["tier2"]
        if t1 not in x or t2 not in x:
            continue
        parts = routed(x, z, m, m.meta["threshold"], t1, t2, m.meta.get("inference_seconds", 0.0))
        add(name, parts[0][0], parts[1][0], parts[0][1], parts[1][1], **diagnostics(x, z, parts, t1, t2),
            tiers=f"{t1} -> {t2}", model=m.meta.get("name"), threshold=m.meta["threshold"])
    online = "aegis+flags" if "+flags" in tier1 else "aegis"
    if online in x and online in z:
        add("aegis (online)", x[online]["failed"], z[online]["failed"], x[online]["seconds"], z[online]["seconds"],
            escalated_fraction=float((x[online]["escalated"].mean() + z[online]["escalated"].mean()) / 2),
            ms_model_mean=float((x[online]["seconds_model"] + z[online]["seconds_model"]).mean() * 1e3),
            ms_tier1_mean=float((x[online]["seconds_tier1"] + z[online]["seconds_tier1"]).mean() * 1e3))
        # Tier 1 sees the same shots in the same order in both runs, so the routing decisions must be
        # identical. Tier 2 is a randomized decoder that has decoded different shots before each
        # escalated one, so its answers agree statistically, not shot by shot.
    if online in x and online in z and cached_tiers:
        cached = routed(x, z, model, model.meta["threshold"], tier1, tier2, 0.0)
        n = len(x[online]["failed"]) + len(z[online]["failed"])
        out["online_agrees_with_cached"] = {
            "decisions": float(((cached[0][2] == x[online]["escalated"]).sum() + (cached[1][2] == z[online]["escalated"]).sum()) / n),
            "failures": float(((cached[0][0] == x[online]["failed"]).sum() + (cached[1][0] == z[online]["failed"]).sum()) / n)}
    out["decoders"] = rows
    final = "aegis (online)" if "aegis (online)" in rows else "aegis"
    out["comparisons"] = {f"{final} vs {other}": compare(pairs[final], pairs[other], times[final], times[other])
                          for other in rows if other not in (final, "aegis", "aegis (online)")}
    if "aegis (accuracy mode)" in rows:
        out["comparisons"]["aegis (accuracy mode) vs relay"] = compare(
            pairs["aegis (accuracy mode)"], pairs["relay+flags" if "+flags" in tier1 else "relay"],
            times["aegis (accuracy mode)"], times["relay+flags" if "+flags" in tier1 else "relay"])
    if cached_tiers:
        F = np.concatenate([x[tier1]["features"], z[tier1]["features"]])
        y = np.concatenate([x[tier1]["failed"], z[tier1]["failed"]])
        out["model_quality"] = quality(model, F, y)
    if not timing and cached_tiers:
        risks = [model.risks(r[tier1]["features"]) for r in (x, z)]
        points = frontier(x, z, risks[0], risks[1], THRESHOLDS, tier1, tier2, model.meta.get("inference_seconds", 0.0))
        out["frontier"], out["pareto"] = points, pareto(points)
    return out


def show(title, result):
    print(f"\n=== {title} ===")
    for name, r in result["decoders"].items():
        esc = f"  esc {100 * r['escalated_fraction']:.1f}%" if "escalated_fraction" in r else ""
        print(f"  {name:22s} [{r['failures_X']:4d} {r['failures_Z']:4d}] pair {r['failures_pair']:4d}  "
              f"LER {r['ler']:.2e} [{r['ler_ci95'][0]:.1e}, {r['ler_ci95'][1]:.1e}]  "
              f"mean {r['ms_mean']:7.1f}  med {r['ms_median']:6.1f}  p95 {r['ms_p95']:6.0f}  p99 {r['ms_p99']:6.0f} ms{esc}")
    for name, c in result["comparisons"].items():
        ratio = "n/a" if c["ler_ratio"] is None else f"{c['ler_ratio']:.2f} [{c['ler_ratio_ci95'][0]:.2f}, {c['ler_ratio_ci95'][1]:.2f}]"
        print(f"  {name:38s} LER ratio {ratio}  McNemar p {c['mcnemar_p']:.3f}  "
              f"speedup {c['speedup_mean']:.2f}x [{c['speedup_mean_ci95'][0]:.2f}, {c['speedup_mean_ci95'][1]:.2f}]")
    if "online_agrees_with_cached" in result:
        print(f"  online decoder agrees with cached policy: {result['online_agrees_with_cached']}")


def load_systems(suffix=""):
    """The chosen systems that exist as model files: primary, accuracy mode, heuristic, ablation."""
    files = {"aegis": f"aegis_router{suffix}.joblib", "aegis (accuracy mode)": f"aegis_router{suffix}_accuracy.joblib",
             "heuristic": f"heuristic_router{suffix}.joblib", "aegis, no loss features": f"aegis_router{suffix}_no_loss_features.joblib"}
    return {name: joblib.load(MODELS / file) for name, file in files.items() if (MODELS / file).exists()}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fractions", type=float, nargs="*", default=[0.25, 0.5, 0.75])
    args = parser.parse_args()
    systems = load_systems()
    report = {"model": {k: v for k, v in systems["aegis"].meta.items() if k != "feature_names"}, "sweep": {}, "timing": {}, "loss": {}}
    for split, key, label in [("test", "sweep", "test, parallel workers"), ("timing", "timing", "timing run, one worker")]:
        for p in SWEEP:
            pair = record_pair(split, p)
            if pair is None:
                continue
            report[key][str(p)] = evaluate_setting(*pair, systems, timing=split == "timing")
            show(f"p = {p} ({label}, {len(pair[0]['observables'])} pairs)", report[key][str(p)])
    loss_systems = load_systems("_loss")
    for f in args.fractions:
        pair = record_pair("test", 0.004, f)
        if pair is None or "aegis" not in loss_systems:
            continue
        result = evaluate_setting(*pair, loss_systems)
        result["decoders"]["bposd (flags ignored)"] = result["decoders"].pop("bposd")
        result["decoders"]["relay (flags ignored)"] = result["decoders"].pop("relay")
        report["loss"][str(f)] = result
        show(f"p = 0.004, erasure fraction {f} ({len(pair[0]['observables'])} pairs)", result)
    if loss_systems:
        report["loss_model"] = {k: v for k, v in loss_systems["aegis"].meta.items() if k != "feature_names"}
    if MANIFEST.exists():
        report["runs"] = json.loads(MANIFEST.read_text())
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "evaluation.json").write_text(json.dumps(report, indent=1))
    print(f"\nwrote {REPORTS / 'evaluation.json'}")


if __name__ == "__main__":
    main()
