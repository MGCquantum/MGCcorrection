"""Routing policies evaluated on cached per-shot records, and the statistics used to compare them.

A policy is a per-shot decision to run tier 2 after tier 1. Because every tier's answer, weight
and time is cached per shot, any policy can be scored exactly without decoding again:

  time   = tier-1 time + model time + (tier-2 time if escalated)
  answer = tier 1's, or the better of the two if escalated (decoder.better)

The final operating point is also run online as one decoder (aegis.collect --tiers aegis).

Pairing: X and Z records that share a seed get the same Stim random stream, so shot k of X and
shot k of Z are correlated samples. Every pair-level statistic here (and therefore threshold
selection in aegis.train and every table in aegis.evaluate) pairs X shot k with Z shot
analyze.z_partner(n)[k], the kit's fixed random derangement, exactly as analyze.py does for the
team's baselines. All decoders compared on one setting use the same pairs.
"""
import numpy as np
from scipy.stats import beta

from analyze import z_partner
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


def clopper_pearson(failures, shots):
    """Exact 95% Clopper-Pearson interval of a failure fraction (as analyze.per_cycle_ci uses);
    valid for zero or few failures."""
    k, n = int(failures), int(shots)
    low = float(beta.ppf(0.025, k, n - k + 1)) if k > 0 else 0.0
    high = float(beta.ppf(0.975, k + 1, n - k)) if k < n else 1.0
    return low, high


def per_cycle(fraction, cycles=CYCLES):
    return 1 - (1 - fraction) ** (1 / cycles)


def partner(n):
    """Index of the Z shot paired with each of n X shots (analyze.z_partner)."""
    return z_partner(int(n))


def pair_failures(failed_x, failed_z):
    """Per pair: X shot k or its independent Z partner failed. Refuses mismatched shapes."""
    failed_x, failed_z = np.asarray(failed_x, bool), np.asarray(failed_z, bool)
    if not (failed_x.ndim == 1 and failed_x.shape == failed_z.shape):
        raise ValueError(f"X and Z records have different shapes {failed_x.shape}, {failed_z.shape}")
    return failed_x | failed_z[partner(len(failed_x))]


def pair_seconds(seconds_x, seconds_z):
    """Per pair: decode time of X shot k plus that of its Z partner."""
    seconds_x, seconds_z = np.asarray(seconds_x, float), np.asarray(seconds_z, float)
    if not (seconds_x.ndim == 1 and seconds_x.shape == seconds_z.shape):
        raise ValueError(f"X and Z records have different shapes {seconds_x.shape}, {seconds_z.shape}")
    return seconds_x + seconds_z[partner(len(seconds_x))]


def summarize(failed_x, failed_z, seconds_x, seconds_z, cycles=CYCLES, rng=None):
    """Metrics over shot pairs, in the kit's convention: a pair (X shot k, its Z partner) fails
    when either fails and its time is the sum of the two decode times."""
    pair = pair_failures(failed_x, failed_z)
    rate, sigma = per_cycle_rate(pair, cycles)
    low, high = (per_cycle(bound, cycles) for bound in clopper_pearson(pair.sum(), len(pair)))
    ms = pair_seconds(seconds_x, seconds_z) * 1e3
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
        pair = pair_failures(fx, fz)
        points.append({"threshold": float(threshold), "failures_pair": int(pair.sum()),
                       "ler": float(per_cycle(pair.mean())), "ms_mean": float(pair_seconds(sx, sz).mean() * 1e3),
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
