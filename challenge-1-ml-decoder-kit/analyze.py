"""Turn cached run_job.py results into the comparison table and plots. Runs in seconds.

  python analyze.py --dir results

File names it expects (from run_job.py):
  train_{X,Z}_p{p}.npz        decoders: bp                 (seed 1)  router training data
  test_{X,Z}_p{p}.npz         decoders: bp relay [bposd]   (seed 2)  required sweep
  erase_{X,Z}_p{p}_f{f}.npz   decoders: bposd bposd_flags  (seed 2)  erasure experiment

Hybrid decoders are computed from the cache, shot by shot:
  hybrid_rule  run fast BP; if it converged keep its answer, else run relay-BP (time = BP + relay)
  hybrid_ml    the router reads the alarms first; "easy" shots follow hybrid_rule,
               "hard" shots go straight to relay-BP (time = router + relay)
A shot pair (X shot k, Z shot k) fails if either fails; its time is the sum of the two.
"""
import argparse
import csv
import glob
import os
import re
import time

import numpy as np
from hybrid import features, train_router as _train_router
from threadpoolctl import threadpool_limits

from scipy.stats import beta

CYCLES = 12
TRAIN_DIR = None   # set by --train-dir; defaults to --dir


def per_cycle_ci(failed, cycles=None):
    """Per-cycle logical error rate with a 95% Clopper-Pearson interval (exact; valid for 0 or few failures)."""
    cycles = cycles or CYCLES
    k, n = int(failed.sum()), len(failed)
    lo = beta.ppf(0.025, k, n - k + 1) if k > 0 else 0.0
    hi = beta.ppf(0.975, k + 1, n - k) if k < n else 1.0
    conv = lambda P: 1 - (1 - P) ** (1 / cycles)
    return conv(k / n), conv(lo), conv(hi), k


def load(path):
    """Load a cached result file and merge any extra decoders run later on the same shots
    (files named extra_<basis>_p<p>*.npz next to test_<basis>_p<p>.npz, same seed and shot count)."""
    d = dict(np.load(path))
    base = os.path.basename(path)
    if base.startswith("test_"):
        for extra in sorted(glob.glob(os.path.join(os.path.dirname(path), base.replace("test_", "extra_").replace(".npz", "*.npz")))):
            e = dict(np.load(extra))
            if int(e["seed"]) != int(d["seed"]) or int(e["shots"]) != int(d["shots"]):
                print(f"skipping {extra}: seed or shot count differs from {base}")
                continue
            if any(not np.array_equal(d[k], e[k]) for k in ("p", "basis", "f")):
                raise ValueError(f"{extra} uses different experimental conditions from {base}")
            hashes_differ = ("sample_sha256" in d and "sample_sha256" in e and
                             str(d["sample_sha256"]) != str(e["sample_sha256"]))
            if hashes_differ or any(not np.array_equal(d[k], e[k]) for k in ("round_weights", "n_flags")):
                # Different Stim builds can generate different shots for the same seed.
                # Use the complete rerun, including its matching router inputs.
                if not {k for k in d if k.startswith(("fail_", "time_", "conv_"))} <= e.keys():
                    raise ValueError(f"{extra} has different shots and lacks some original decoder results")
                d = e
                continue
            d.update({k: v for k, v in e.items() if k.split("_")[0] in ("fail", "time", "conv")})
    return d


def train_router(dirname, p):
    return _train_router(TRAIN_DIR or dirname, p)


def policies(d, router):
    """(fail, time) per shot for each decoder and hybrid available in one test file."""
    out = {n: (d[f"fail_{n}"], d[f"time_{n}"]) for n in ("relay", "bposd", "bp", "bposd_flags") if f"fail_{n}" in d}
    if "fail_bp" in d and "fail_relay" in d:
        conv = d["conv_bp"]
        rule_fail = np.where(conv, d["fail_bp"], d["fail_relay"])
        rule_time = d["time_bp"] + np.where(conv, 0, d["time_relay"])
        out["hybrid_rule"] = (rule_fail, rule_time)
        if router is not None:
            model, w_threshold = router
            X = features(d)
            easy = model.predict(X).astype(bool)
            sample = X[:200]
            t = time.perf_counter()
            for row in sample:                     # time one shot at a time, as a real decoder would run
                model.predict(row[None, :])
            per_shot = (time.perf_counter() - t) / len(sample)
            out["hybrid_ml"] = (np.where(easy, rule_fail, d["fail_relay"]),
                                per_shot + np.where(easy, rule_time, d["time_relay"]))
            out["_router_acc"] = (easy == conv).mean()
            out["_baseline_acc"] = max(conv.mean(), 1 - conv.mean())
            out["_weight_acc"] = ((X[:, -2] <= w_threshold) == conv).mean()
            out["_escalated_ml"] = (~easy | ~conv).mean()
        out["_escalated_rule"] = (~conv).mean()
    return out


def paired(px, pz, name):
    fx, tx = px[name]
    fz, tz = pz[name]
    rate, lo, hi, k = per_cycle_ci(fx | fz)
    ms = (tx + tz) * 1e3
    return rate, lo, hi, k, len(fx), ms.mean(), np.percentile(ms, 99)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--dir", default="results")
    a.add_argument("--train-dir", help="where train_*.npz live (default: --dir), e.g. results for results_timing")
    args = a.parse_args()
    global TRAIN_DIR
    TRAIN_DIR = args.train_dir
    rows = []
    ps = sorted({re.search(r"_p([\d.]+)\.npz", f).group(1) for f in glob.glob(f"{args.dir}/test_X_p*.npz")})
    for p in ps:
        if not os.path.exists(f"{args.dir}/test_Z_p{p}.npz"):
            print(f"p={p}: waiting for test_Z_p{p}.npz")
            continue
        router = train_router(args.dir, p)
        px = policies(load(f"{args.dir}/test_X_p{p}.npz"), router)
        pz = policies(load(f"{args.dir}/test_Z_p{p}.npz"), router)
        for name in [n for n in px if not n.startswith("_") and n in pz]:
            rate, lo, hi, k, n, mean_ms, p99 = paired(px, pz, name)
            esc = {"hybrid_rule": px.get("_escalated_rule"), "hybrid_ml": px.get("_escalated_ml")}.get(name)
            rows.append({"experiment": "sweep", "p": p, "f": 0, "decoder": name, "rate_per_cycle": rate, "ci_low": lo,
                         "ci_high": hi, "failed_pairs": k, "pairs": n, "mean_ms": mean_ms, "p99_ms": p99, "escalated_X": esc})
        if "_router_acc" in px:
            print(f"p={p} predicting BP convergence (X test shots): ML router {px['_router_acc']:.3f}, "
                  f"alarm-count threshold {px['_weight_acc']:.3f}, always-guess-majority {px['_baseline_acc']:.3f}")
    for fx in sorted(glob.glob(f"{args.dir}/erase_X_p*_f*.npz")):
        p, f = re.search(r"_p([\d.]+)_f([\d.]+)\.npz", fx).groups()
        fz = fx.replace("erase_X", "erase_Z")
        if not os.path.exists(fz):
            continue
        px, pz = policies(load(fx), None), policies(load(fz), None)
        for name in [n for n in px if not n.startswith("_") and n in pz]:
            rate, lo, hi, k, n, mean_ms, p99 = paired(px, pz, name)
            rows.append({"experiment": "erasure", "p": p, "f": f, "decoder": name, "rate_per_cycle": rate, "ci_low": lo,
                         "ci_high": hi, "failed_pairs": k, "pairs": n, "mean_ms": mean_ms, "p99_ms": p99, "escalated_X": None})
    if not rows:
        print("no result files found")
        return
    with open(f"{args.dir}/results.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        esc = "" if r["escalated_X"] is None else f"  escalated {r['escalated_X']:.0%}"
        rate = (f"< {r['ci_high']:.1e} (0 of {r['pairs']} pairs failed)" if r["failed_pairs"] == 0 else
                f"{r['rate_per_cycle']:.2e} [95% CI {r['ci_low']:.1e}-{r['ci_high']:.1e}, {r['failed_pairs']}/{r['pairs']}]")
        print(f"{r['experiment']:8s} p={r['p']} f={r['f']}  {r['decoder']:12s} rate {rate}  "
              f"mean {r['mean_ms']:.0f} ms  p99 {r['p99_ms']:.0f} ms{esc}")
    plot(rows, args.dir)


def _ci_plot(ax, x, rs, name):
    """Points with 95% CIs; a zero-failure point is drawn as a downward triangle at its upper bound."""
    y = [r["rate_per_cycle"] if r["failed_pairs"] else r["ci_high"] for r in rs]
    lo = [y[i] - r["ci_low"] if r["failed_pairs"] else 0 for i, r in enumerate(rs)]
    hi = [r["ci_high"] - y[i] if r["failed_pairs"] else 0 for i, r in enumerate(rs)]
    line_y = [value if rs[i]["failed_pairs"] else float("nan") for i, value in enumerate(y)]
    line = ax.errorbar(x, line_y, [lo, hi], marker="o", label=name, capsize=3)
    zero = [i for i, r in enumerate(rs) if not r["failed_pairs"]]
    if zero:
        ax.scatter([x[i] for i in zero], [y[i] for i in zero], marker="v", s=80, color=line[0].get_color(), zorder=5)


def plot(rows, dirname):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    has_erasure = any(r["experiment"] == "erasure" for r in rows)
    count = 3 if has_erasure else 2
    fig, ax = plt.subplots(1, count, figsize=(5 * count, 4))
    sweep = [r for r in rows if r["experiment"] == "sweep"]
    for name in sorted({r["decoder"] for r in sweep}):
        rs = sorted([r for r in sweep if r["decoder"] == name], key=lambda r: float(r["p"]))
        x = [float(r["p"]) for r in rs]
        _ci_plot(ax[0], x, rs, name)
        ax[1].plot(x, [r["mean_ms"] for r in rs], marker="o", label=f"{name} mean")
        ax[1].plot(x, [r["p99_ms"] for r in rs], ls="--", marker="x", label=f"{name} p99")
    ax[0].set(xlabel="physical error rate p", ylabel="logical error rate per cycle", yscale="log", title="Accuracy")
    ax[1].set(xlabel="physical error rate p", ylabel="decode time per shot pair (ms)", yscale="log", title="Speed")
    erase = [r for r in rows if r["experiment"] == "erasure"]
    for name in sorted({r["decoder"] for r in erase}):
        rs = sorted([r for r in erase if r["decoder"] == name], key=lambda r: float(r["f"]))
        _ci_plot(ax[2], [float(r["f"]) for r in rs], rs, name)
    if erase:
        ax[2].set(xlabel="fraction of noise converted to heralded erasure (triangle = upper bound, 0 failures)", ylabel="logical error rate per cycle",
                  yscale="log", title="Using erasure flags")
    for x in ax:
        if x.get_legend_handles_labels()[0]:
            x.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(f"{dirname}/results.png", dpi=150)
    print(f"saved {dirname}/results.csv and {dirname}/results.png")


if __name__ == "__main__":
    with threadpool_limits(limits=1):
        main()
