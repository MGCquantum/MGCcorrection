"""Presentation figures from the saved results (seconds to run).

  python make_figures.py      ->  figures/erasure.png, figures/speed.png
"""
import csv
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

os.makedirs("figures", exist_ok=True)


def rows(path):
    with open(path) as fh:
        return [{k: (float(v) if k not in ("experiment", "decoder", "escalated_X") else v) for k, v in r.items()}
                for r in csv.DictReader(fh)]


def point(r):
    """(y, lower error, upper error, is_upper_bound)."""
    if r["failed_pairs"] == 0:
        return r["ci_high"], 0, 0, True
    return r["rate_per_cycle"], r["rate_per_cycle"] - r["ci_low"], r["ci_high"] - r["rate_per_cycle"], False


main = rows("results/results.csv")
erase = sorted([r for r in main if r["experiment"] == "erasure"], key=lambda r: r["f"])
fig, ax = plt.subplots(figsize=(6.5, 4.5))
for name, label, color in [("bposd", "Decoder ignores loss flags", "#888780"),
                           ("bposd_flags", "Decoder uses loss flags", "#D85A30")]:
    rs = [r for r in erase if r["decoder"] == name]
    pts = [point(r) for r in rs]
    x = [r["f"] * 100 for r in rs]
    ax.errorbar(x, [p[0] for p in pts], [[p[1] for p in pts], [p[2] for p in pts]], marker="o", capsize=4,
                lw=2, color=color, label=label)
    for xi, p in zip(x, pts):
        if p[3]:
            ax.annotate("0 failures\n(upper bound)", (xi, p[0]), textcoords="offset points", xytext=(-10, -28),
                        fontsize=8, color=color, ha="center")
            ax.scatter([xi], [p[0]], marker="v", s=90, color=color, zorder=5)
ax.set(yscale="log", xlabel="Share of gate/idle noise that is flagged erasure (%)",
       ylabel="Logical error rate per cycle",
       title="Gross code [[144,12,12]], p = 0.004: using erasure flags")
ax.legend()
ax.grid(alpha=0.3, which="both")
fig.tight_layout()
fig.savefig("figures/erasure.png", dpi=200)

def plot_timing(dirname, filename, title):
    timing = [r for r in rows(f"{dirname}/results.csv") if r["experiment"] == "sweep"]
    fig, ax = plt.subplots(figsize=(6.5, 4.5))
    for name, label, color in [("bposd", "BP-OSD (baseline)", "#A65E2E"), ("relay", "relay-BP (baseline)", "#185FA5"), ("hybrid_rule", "Hybrid: fast BP, then relay-BP", "#1D9E75"),
                               ("hybrid_ml", "Hybrid with ML router", "#7F77DD")]:
        rs = sorted([r for r in timing if r["decoder"] == name], key=lambda r: r["p"])
        if rs:
            ax.plot([r["p"] for r in rs], [r["mean_ms"] for r in rs], marker="o", lw=2, color=color, label=f"{label}, mean")
            ax.plot([r["p"] for r in rs], [r["p99_ms"] for r in rs], marker="x", ls="--", color=color, alpha=0.6,
                    label=f"{label}, slowest 1%")
    ax.set(yscale="log", xlabel="Physical error rate p", ylabel="Decode time per X+Z shot pair (ms)",
           title=title, xticks=[0.003, 0.004, 0.005])
    ax.legend(fontsize=7)
    ax.grid(alpha=0.3, which="both")
    fig.tight_layout()
    fig.savefig(filename, dpi=200)
    plt.close(fig)

plot_timing("results_timing", "figures/speed.png", "Historical idle laptop (1 thread, 300 pairs)")
if os.path.exists("results_local_timing/results.csv"):
    plot_timing("results_local_timing", "figures/speed_local.png", "Local concurrent load (1 worker, 300 pairs)")
print("saved erasure and available timing figures")
