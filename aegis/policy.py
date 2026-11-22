"""Routing policies evaluated on cached per-shot records, and the statistics used to compare them.

A policy is a per-shot decision to run tier 2 after tier 1. Because every tier's answer, weight
and time is cached per shot, any policy can be scored exactly without decoding again:

  time   = tier-1 time + model time + (tier-2 time if escalated)
  answer = tier 1's, or the better of the two if escalated (decoder.better)

The final operating point is also run online as one decoder (aegis.collect --tiers aegis).
"""
import numpy as np

from decoders import per_cycle_rate

from . import CYCLES


def oracle_route(first, second):
    """Per-shot (failed, seconds, escalated) of a router that knows the truth: an UNATTAINABLE bound.

    It escalates exactly the shots tier 1 gets wrong (and the unconverged ones, which any router
    sees), and keeps whichever answer is correct. No deployable router can do better with these two
    tiers, at any threshold, in failures or in time."""
    escalate = first["failed"] | ~first["converged"]
    failed = first["failed"] & second["failed"]
    seconds = first["seconds"] + np.where(escalate, second["seconds"], 0.0)
    return failed, seconds, escalate


def route(first, second, escalate, overhead=0.0):
    """Per-shot (failed, seconds, escalated) of routing between two cached tiers."""
    escalate = escalate | ~first["converged"]
    take_second = escalate & second["converged"] & (~first["converged"] | (second["weight"] <= first["weight"]))
    failed = np.where(take_second, second["failed"], first["failed"])
    seconds = first["seconds"] + overhead + np.where(escalate, second["seconds"], 0.0)
    return failed, seconds, escalate


def wilson(failures, shots, z=1.96):
    """95% Wilson interval of a failure fraction."""
    f = failures / shots
    centre = (f + z * z / (2 * shots)) / (1 + z * z / shots)
    half = z * np.sqrt(f * (1 - f) / shots + z * z / (4 * shots * shots)) / (1 + z * z / shots)
    return max(centre - half, 0.0), min(centre + half, 1.0)


def per_cycle(fraction, cycles=CYCLES):
    return 1 - (1 - fraction) ** (1 / cycles)


def summarize(failed_x, failed_z, seconds_x, seconds_z, cycles=CYCLES, rng=None):
    """Metrics over shot pairs, in the kit's convention: a pair fails when either basis fails
    and its time is the sum of the two decode times."""
    pair = failed_x | failed_z
    rate, sigma = per_cycle_rate(pair, cycles)
    low, high = (per_cycle(bound, cycles) for bound in wilson(pair.sum(), len(pair)))
    ms = (seconds_x + seconds_z) * 1e3
    rng = rng or np.random.default_rng(0)
    means = ms[rng.integers(0, len(ms), size=(1000, len(ms)))].mean(axis=1)
    return {"pairs": int(len(pair)), "failures_X": int(failed_x.sum()), "failures_Z": int(failed_z.sum()),
            "failures_pair": int(pair.sum()), "ler": float(rate), "ler_sigma": float(sigma),
            "ler_ci95": [float(low), float(high)], "ms_mean": float(ms.mean()),
            "ms_mean_ci95": [float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))],
            "ms_median": float(np.median(ms)), "ms_p95": float(np.percentile(ms, 95)),
            "ms_p99": float(np.percentile(ms, 99)), "ms_max": float(ms.max()),
            "pairs_per_second": float(1e3 / ms.mean())}


def compare(pair_a, pair_b, ms_a=None, ms_b=None, cycles=CYCLES, seed=0):
    """Paired comparison of decoder A against decoder B on the same shot pairs.

    Failures: exact McNemar test on the discordant pairs, and a paired bootstrap interval of the
    ratio of logical error rates. Times: paired bootstrap interval of the ratio of mean times.
    """
    from scipy.stats import binomtest
    only_a, only_b = int((pair_a & ~pair_b).sum()), int((pair_b & ~pair_a).sum())
    out = {"both_fail": int((pair_a & pair_b).sum()), "only_a_fails": only_a, "only_b_fails": only_b,
           "mcnemar_p": float(binomtest(only_a, only_a + only_b, 0.5).pvalue) if only_a + only_b else 1.0}
    rng = np.random.default_rng(seed)
    draws = rng.integers(0, len(pair_a), size=(2000, len(pair_a)))
    fa, fb = pair_a[draws].mean(axis=1), pair_b[draws].mean(axis=1)
    ok = fb > 0
    ratio = per_cycle(fa[ok], cycles) / per_cycle(fb[ok], cycles)
    out["ler_ratio"] = float(per_cycle(pair_a.mean(), cycles) / per_cycle(pair_b.mean(), cycles)) if pair_b.any() else None
    out["ler_ratio_ci95"] = [float(np.percentile(ratio, 2.5)), float(np.percentile(ratio, 97.5))] if ok.any() else None
    if ms_a is not None:
        speed = ms_b[draws].mean(axis=1) / ms_a[draws].mean(axis=1)
        out["speedup_mean"] = float(ms_b.mean() / ms_a.mean())
        out["speedup_mean_ci95"] = [float(np.percentile(speed, 2.5)), float(np.percentile(speed, 97.5))]
    return out


def frontier(x, z, risk_x, risk_z, thresholds, tier1="fast", tier2="strong", overhead=0.0):
    """LER and latency of threshold routing at every threshold (the Pareto sweep)."""
    points = []
    for threshold in thresholds:
        fx, sx, ex = route(x[tier1], x[tier2], risk_x >= threshold, overhead)
        fz, sz, ez = route(z[tier1], z[tier2], risk_z >= threshold, overhead)
        pair = fx | fz
        points.append({"threshold": float(threshold), "failures_pair": int(pair.sum()),
                       "ler": float(per_cycle(pair.mean())), "ms_mean": float((sx + sz).mean() * 1e3),
                       "escalated": float((ex.mean() + ez.mean()) / 2)})
    return points


def pareto(points):
    """The points no other point beats on both LER and mean time."""
    best, kept = np.inf, []
    for point in sorted(points, key=lambda q: (q["ms_mean"], q["ler"])):
        if point["ler"] < best:
            kept.append(point)
            best = point["ler"]
    return kept


def select_threshold(points, target_failures):
    """Risk-aware choice: the fastest threshold whose validation failures stay within the target."""
    allowed = [q for q in points if q["failures_pair"] <= target_failures]
    return min(allowed, key=lambda q: q["ms_mean"]) if allowed else min(points, key=lambda q: q["failures_pair"])


def threshold_for_budget(risk, budget):
    """Budgeted fallback: the threshold that escalates at most a fraction `budget` of these shots."""
    return float(np.quantile(risk, 1 - budget)) if budget < 1 else 0.0
