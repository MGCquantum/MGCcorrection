"""Train the router on BP features and evaluate the hierarchy offline from cached results.

  python evaluate.py --train feats_train_0.004.npz --test feats_test_0.004.npz --strong bposd
"""
import argparse
import time

import matplotlib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

from decoders import per_cycle_rate

matplotlib.use("Agg")
import matplotlib.pyplot as plt

CYCLES = 12


def hierarchy(escalate, bp_failed, bp_sec, s_failed, s_sec, router_sec):
    failed = np.where(escalate, s_failed, bp_failed)
    sec = bp_sec + router_sec + escalate * s_sec
    return failed, sec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", required=True)
    ap.add_argument("--test", required=True)
    ap.add_argument("--strong", default="bposd")
    ap.add_argument("--out", default="tradeoff.png")
    args = ap.parse_args()

    tr, te = np.load(args.train), np.load(args.test)
    Xtr, ytr, Xte = tr["X"], tr["bp_failed"], te["X"]
    print(f"train: {len(ytr)} shots, BP failed {ytr.sum()} ({ytr.mean():.3f})")

    clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.1).fit(Xtr, ytr)
    t = time.perf_counter()
    score = clf.predict_proba(Xte)[:, 1]
    router_sec = (time.perf_counter() - t) / len(Xte)   # batched; single-shot would be slower
    print(f"router: {router_sec * 1e6:.1f} us/shot (batched)")

    bp_f, bp_s = te["bp_failed"], te["bp_sec"]
    s_f, s_s = te[f"{args.strong}_failed"], te[f"{args.strong}_sec"]

    def row(name, failed, sec):
        r, e = per_cycle_rate(failed, CYCLES)
        print(f"{name:28s} fail {failed.sum():5d}  per cycle {r:.2e} +- {e:.1e}  mean {sec.mean() * 1e3:8.2f} ms"
              f"  p99 {np.percentile(sec, 99) * 1e3:8.1f} ms")
        return r, sec.mean() * 1e3

    print()
    row("plain BP only", bp_f, bp_s)
    pts = {"strong only": row(f"{args.strong} only", s_f, s_s)}
    rule = ~te["X"][:, 1].astype(bool)   # escalate if BP did not converge
    esc_frac = rule.mean()
    pts["rule: not converged"] = row(f"rule: escalate if !conv ({esc_frac:.0%})", *hierarchy(rule, bp_f, bp_s, s_f, s_s, 0))

    sweep = []
    for thr in np.unique(np.quantile(score, np.linspace(0, 1, 41))):
        esc = score > thr
        failed, sec = hierarchy(esc, bp_f, bp_s, s_f, s_s, router_sec)
        r, _ = per_cycle_rate(failed, CYCLES)
        sweep.append((esc.mean(), r, sec.mean() * 1e3))
    sweep = np.array(sweep)

    print("\nrouter sweep (escalated fraction, rate/cycle, mean ms):")
    for f, r, ms in sweep[:: max(1, len(sweep) // 10)]:
        print(f"  {f:6.1%}  {r:.2e}  {ms:8.2f}")

    fig, ax = plt.subplots(1, 2, figsize=(10, 4))
    ax[0].plot(sweep[:, 0] * 100, sweep[:, 1], "o-", label="ML router")
    ax[0].axhline(pts["strong only"][0], color="g", ls="--", label=f"{args.strong} only")
    ax[0].plot(esc_frac * 100, pts["rule: not converged"][0], "r*", ms=12, label="rule: !converged")
    ax[0].set(xlabel="% shots escalated", ylabel="logical error rate / cycle", yscale="log")
    ax[0].legend()
    ax[1].plot(sweep[:, 2], sweep[:, 1], "o-", label="ML router")
    ax[1].plot(pts["strong only"][1], pts["strong only"][0], "gs", label=f"{args.strong} only")
    ax[1].plot(pts["rule: not converged"][1], pts["rule: not converged"][0], "r*", ms=12, label="rule: !converged")
    ax[1].set(xlabel="mean decode time (ms)", ylabel="logical error rate / cycle", yscale="log", xscale="log")
    ax[1].legend()
    plt.tight_layout()
    plt.savefig(args.out, dpi=150)
    print("saved", args.out)


if __name__ == "__main__":
    main()