"""Figures from the stored evaluation (experiments/reports/*.json). No decoding happens here.

  python -m aegis.figures      ->  docs/figures/*.png

Colors identify the decoder and stay the same in every figure. Each decoder also has its own
marker, so no figure depends on color alone.
"""
import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.ticker import FuncFormatter, LogLocator, NullFormatter  # noqa: E402

from .paths import ROOT  # noqa: E402

REPORTS = ROOT / "experiments" / "reports"
FIGURES = ROOT / "docs" / "figures"
INK, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e1e0d9", "#fcfcfb"
# decoder -> (label, color, marker). Fixed order: a decoder keeps its color everywhere.
STYLE = {
    "bposd": ("BP-OSD", "#2a78d6", "s"),
    "relay": ("relay-BP", "#eb6834", "o"),
    "aegis": ("QEC-Aegis", "#1baf7a", "D"),
    "rule (no ML)": ("rule, no ML", "#eda100", "^"),
    "tier 1 alone": ("tier 1 alone", "#6250d6", "v"),
}
plt.rcParams.update({"font.size": 10, "axes.edgecolor": "#c3c2b7", "axes.labelcolor": MUTED, "xtick.color": MUTED,
                     "ytick.color": MUTED, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True,
                     "grid.color": GRID, "grid.linewidth": 0.6, "axes.axisbelow": True, "figure.facecolor": SURFACE,
                     "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE, "axes.titlesize": 11,
                     "axes.titleweight": "bold", "axes.titlelocation": "left", "legend.frameon": False})


def final(decoders):
    """The routed decoder's row: the online run when it exists, else the cached policy."""
    # Not decoders.get(..., decoders["aegis"]): the default is evaluated eagerly, and timing results
    # hold only the online row.
    return decoders["aegis (online)"] if "aegis (online)" in decoders else decoders["aegis"]


def rows(result):
    return {key: (final(result["decoders"]) if key == "aegis" else result["decoders"][key])
            for key in STYLE if key == "aegis" or key in result["decoders"]}


def save(fig, name, caption_lines=0):
    """caption_lines: lines of fig.text caption at the bottom; the axes are kept clear of them."""
    FIGURES.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(rect=(0, 0.035 * caption_lines, 1, 1))
    fig.savefig(FIGURES / name, dpi=160)
    plt.close(fig)
    print("wrote", FIGURES / name)


def plain_log_ticks(axis):
    """Log axis labelled 10, 20, 50, 100 ... instead of overlapping 2×10^1, 3×10^1 labels."""
    axis.set_major_locator(LogLocator(subs=(1, 2, 5)))
    axis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}"))
    axis.set_minor_formatter(NullFormatter())


def ler_vs_p(report):
    fig, ax = plt.subplots(figsize=(6.2, 4.2))
    ps = sorted(report["sweep"], key=float)
    for key in ("bposd", "relay", "aegis"):
        label, color, marker = STYLE[key]
        data = [rows(report["sweep"][p])[key] for p in ps]
        x = np.array([float(p) for p in ps])
        y = np.array([d["ler"] for d in data])
        low, high = np.array([d["ler_ci95"] for d in data]).T
        shift = {"bposd": 0.0, "relay": -0.00003, "aegis": 0.00003}[key]   # keep overlapping intervals apart
        ax.errorbar(x + shift, y, [y - low, high - y], color=color, marker=marker, ms=7, lw=2, capsize=3, label=label,
                    markeredgecolor=SURFACE, markeredgewidth=1)
    ax.set(yscale="log", xlabel="physical error rate p", ylabel="logical error rate per cycle", xticks=[float(p) for p in ps],
           title="Logical error rate on the frozen test shots")
    pairs = ", ".join(f"{rows(report['sweep'][p])['relay']['pairs']:,} at {p}" for p in ps)
    ax.text(0, -0.27, f"Bars: exact 95% Clopper–Pearson intervals.\nIndependent X/Z pairs: {pairs}.", transform=ax.transAxes, fontsize=8, color=MUTED)
    ax.legend(loc="upper left")
    save(fig, "ler_vs_p.png")


def latency(report):
    source = report["timing"] if report.get("timing") else report["sweep"]
    note = "one worker, nothing else running" if report.get("timing") else "parallel workers (contended)"
    ps = sorted(source, key=float)
    fig, axes = plt.subplots(1, 2, figsize=(9.6, 4.0))
    for ax, field, title in [(axes[0], "ms_mean", "Mean decode time per shot pair"), (axes[1], "ms_p99", "99th percentile")]:
        keys = [k for k in ("bposd", "relay", "aegis") if k in rows(source[ps[0]])]
        width = 0.8 / len(keys)
        for i, key in enumerate(keys):
            label, color, _ = STYLE[key]
            values = [rows(source[p])[key][field] for p in ps]
            bars = ax.bar(np.arange(len(ps)) + (i - (len(keys) - 1) / 2) * width, values, width * 0.9, color=color, label=label)
            for bar, value in zip(bars, values):
                ax.text(bar.get_x() + bar.get_width() / 2, value * 1.06, f"{value:,.0f}", ha="center", fontsize=8, color=INK)
        ax.set(yscale="log", xticks=np.arange(len(ps)), xticklabels=[f"p = {p}" for p in ps], ylabel="milliseconds", title=title)
        ax.grid(axis="x", visible=False)
    axes[0].legend(loc="upper left")
    fig.text(0.01, 0.005, f"Latency run: {note}. Pair time = X decode + Z decode. Labels in ms.", fontsize=8, color=MUTED)
    save(fig, "latency.png", caption_lines=1)


def pareto(report):
    ps = sorted(report["sweep"], key=float)
    fig, axes = plt.subplots(1, len(ps), figsize=(4.3 * len(ps), 4.1))
    for ax, p in zip(np.atleast_1d(axes), ps):
        result = report["sweep"][p]
        front = sorted(result["frontier"], key=lambda q: q["ms_mean"])
        ax.plot([q["ms_mean"] for q in front], [q["ler"] for q in front], color="#1baf7a", lw=1.5, alpha=0.6, zorder=1)
        ax.scatter([q["ms_mean"] for q in front], [q["ler"] for q in front], s=10, color="#1baf7a", alpha=0.6, zorder=1,
                   label="QEC-Aegis, all thresholds")
        for key in ("bposd", "relay", "rule (no ML)"):
            if key in result["decoders"]:
                label, color, marker = STYLE[key]
                d = result["decoders"][key]
                ax.scatter(d["ms_mean"], d["ler"], s=80, color=color, marker=marker, edgecolor=SURFACE, linewidth=1.2, label=label, zorder=3)
        d = result["decoders"]["aegis"]
        ax.scatter(d["ms_mean"], d["ler"], s=110, color="#1baf7a", marker="D", edgecolor=INK, linewidth=1.2, zorder=4,
                   label="QEC-Aegis, chosen threshold")
        ax.set(xscale="log", yscale="log", xlabel="mean decode time per shot pair (ms)", title=f"p = {p}")
        plain_log_ticks(ax.xaxis)
    np.atleast_1d(axes)[0].set_ylabel("logical error rate per cycle")
    np.atleast_1d(axes)[-1].legend(fontsize=8, loc="upper right")
    fig.text(0.01, 0.005, "Lower left is better. The threshold was chosen on validation shots; the curve is the same policy at every other "
             "threshold on the test shots. Times from the parallel test run.", fontsize=8, color=MUTED)
    save(fig, "pareto.png", caption_lines=1)


def routing(report):
    ps = sorted(report["sweep"], key=float)
    fig, axes = plt.subplots(1, 2, figsize=(9.6, 3.9))
    d = [report["sweep"][p]["decoders"]["aegis"] for p in ps]
    x = np.arange(len(ps))
    unconverged = np.array([100 * q["unconverged"] / q["shots"] for q in d])
    flagged = np.array([100 * q["flagged_by_model"] / q["shots"] for q in d])
    axes[0].bar(x, unconverged, 0.5, color="#eda100", label="tier 1 did not converge")
    gap = 0.02 * (unconverged + flagged).max()          # white line between the two causes
    axes[0].bar(x, flagged, 0.5, bottom=unconverged + gap, color="#1baf7a", label="flagged by the risk model")
    for i, total in enumerate(unconverged + flagged):
        axes[0].text(i, unconverged[i] + gap + flagged[i] + 2 * gap, f"{total:.2g}%", ha="center", va="bottom", fontsize=9, color=INK)
    axes[0].set(xticks=x, xticklabels=[f"p = {p}" for p in ps], ylabel="shots sent to tier 2 (%)", title="How often tier 2 runs")
    axes[0].legend(loc="upper left")
    axes[0].grid(axis="x", visible=False)
    caught = [q["hidden_failures_caught"] for q in d]
    missed = [q["hidden_failures"] - q["hidden_failures_caught"] for q in d]
    axes[1].bar(x - 0.2, caught, 0.38, color="#1baf7a", label="caught by the risk model")
    axes[1].bar(x + 0.2, missed, 0.38, color="#898781", label="missed")
    for i, (a, b) in enumerate(zip(caught, missed)):
        axes[1].text(i - 0.2, a, str(a), ha="center", va="bottom", fontsize=9, color=INK)
        axes[1].text(i + 0.2, b, str(b), ha="center", va="bottom", fontsize=9, color=INK)
    axes[1].set(xticks=x, xticklabels=[f"p = {p}" for p in ps], ylabel="shots", title="Wrong tier-1 answers that looked converged")
    axes[1].legend(loc="upper left")
    axes[1].grid(axis="x", visible=False)
    save(fig, "routing.png")


def loss(report):
    if not report.get("loss"):
        return
    fs = sorted(report["loss"], key=float)
    series = [("bposd (flags ignored)", "BP-OSD, flags ignored", "#2a78d6", "s", "--"),
              ("relay (flags ignored)", "relay-BP, flags ignored", "#eb6834", "o", "--"),
              ("bposd+flags", "BP-OSD with flags", "#2a78d6", "s", "-"),
              ("relay+flags", "relay-BP with flags", "#eb6834", "o", "-"),
              ("aegis", "QEC-Aegis with flags", "#1baf7a", "D", "-")]
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.1))
    for key, label, color, marker, style in series:
        data = [(float(f), (final(report["loss"][f]["decoders"]) if key == "aegis" else report["loss"][f]["decoders"].get(key))) for f in fs]
        data = [(f, d) for f, d in data if d]
        if not data:
            continue
        x = np.array([f for f, _ in data])
        y = np.array([max(d["ler"], 1e-7) for _, d in data])
        low, high = np.array([d["ler_ci95"] for _, d in data]).T
        axes[0].errorbar(x, y, [np.maximum(y - low, 0), np.maximum(high - y, 0)], color=color, marker=marker, ls=style, lw=2, ms=7,
                         capsize=3, label=label, markeredgecolor=SURFACE)
        axes[1].plot(x, [d["ms_mean"] for _, d in data], color=color, marker=marker, ls=style, lw=2, ms=7, label=label, markeredgecolor=SURFACE)
    axes[0].set(yscale="log", xlabel="fraction f of gate noise converted to heralded erasure", ylabel="logical error rate per cycle",
                xticks=[float(f) for f in fs], title="Using the herald flags, p = 0.004")
    axes[1].set(yscale="log", xlabel="fraction f of gate noise converted to heralded erasure", ylabel="mean decode time per shot pair (ms)",
                xticks=[float(f) for f in fs], title="Decode time")
    plain_log_ticks(axes[1].yaxis)
    axes[0].legend(fontsize=8)
    fig.text(0.01, 0.005, "Simplified heralded-erasure model. Dashed: herald flags ignored. Solid: flags used as per-shot priors. "
             "A point at zero failures is drawn at its upper 95% bound's lower edge.", fontsize=8, color=MUTED)
    save(fig, "loss.png", caption_lines=1)


def calibration():
    path = REPORTS / "calibration.json"
    if not path.exists():
        return
    data = json.loads(path.read_text())
    fig, ax = plt.subplots(figsize=(5.2, 4.4))
    predicted, observed = np.array(data["predicted"]), np.array(data["observed"])
    low, high = np.array(data["observed_ci95"]).T
    shown = observed > 0
    ax.plot([1e-6, 1], [1e-6, 1], color="#898781", lw=1, ls="--", label="perfect calibration")
    ax.errorbar(predicted[shown], observed[shown], [observed[shown] - low[shown], high[shown] - observed[shown]], color="#1baf7a",
                marker="D", lw=1.5, capsize=3, label="QEC-Aegis risk model", markeredgecolor=SURFACE)
    ax.set(xscale="log", yscale="log", xlabel="predicted risk (bin mean)", ylabel="observed fraction of wrong tier-1 answers",
           title=f"Calibration on {data['split']} shots")
    ax.legend(loc="upper left")
    save(fig, "calibration.png")


# QEC-Aegis v2 on fresh shots (experiments/reports/v2_evaluation.json). v1 keeps the Aegis green.
V2_STYLE = {
    "bposd": STYLE["bposd"],
    "relay": STYLE["relay"],
    "aegis v1 (online)": ("QEC-Aegis v1", "#1baf7a", "D"),
    "aegis v2 speed (online)": ("QEC-Aegis v2, speed", "#6250d6", "^"),
    "aegis v2 accuracy (online)": ("QEC-Aegis v2, accuracy", "#c8336f", "v"),
}


def v2_ler_vs_p(v2):
    ps = sorted(v2["sweep"], key=float)
    fig, ax = plt.subplots(figsize=(6.8, 4.4))
    shifts = np.linspace(-0.00008, 0.00008, len(V2_STYLE))   # keep overlapping intervals apart
    for shift, (key, (label, color, marker)) in zip(shifts, V2_STYLE.items()):
        data = [v2["sweep"][p]["decoders"][key] for p in ps]
        x = np.array([float(p) for p in ps]) + shift
        y = np.array([d["ler"] for d in data])
        low, high = np.array([d["ler_ci95"] for d in data]).T
        ax.errorbar(x, y, [y - low, high - y], color=color, marker=marker, ms=7, lw=2, capsize=3, label=label,
                    markeredgecolor=SURFACE, markeredgewidth=1)
    ax.set(yscale="log", xlabel="physical error rate p", ylabel="logical error rate per cycle", xticks=[float(p) for p in ps],
           title="Logical error rate on fresh test shots (seed 7)")
    pairs = ", ".join(f"{v2['sweep'][p]['decoders']['relay']['pairs']:,} at {p}" for p in ps)
    ax.text(0, -0.27, f"Bars: exact 95% Clopper–Pearson intervals; markers offset sideways for readability.\n"
            f"Independent X/Z pairs, the same shots for every decoder: {pairs}.", transform=ax.transAxes, fontsize=8, color=MUTED)
    ax.legend(loc="upper left", fontsize=8)
    save(fig, "v2_ler_vs_p.png")


def v2_latency(v2):
    ps = sorted(v2["timing"], key=float)
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
    width = 0.8 / len(V2_STYLE)
    for ax, field, title in [(axes[0], "ms_mean", "Mean decode time per shot pair"), (axes[1], "ms_p99", "99th percentile")]:
        for i, (key, (label, color, _)) in enumerate(V2_STYLE.items()):
            data = [v2["timing"][p]["decoders"][key] for p in ps]
            values = np.array([d[field] for d in data])
            x = np.arange(len(ps)) + (i - (len(V2_STYLE) - 1) / 2) * width
            error = None
            if field == "ms_mean":
                low, high = np.array([d["ms_mean_ci95"] for d in data]).T
                error = [values - low, high - values]
            ax.bar(x, values, width * 0.9, color=color, label=label, yerr=error, capsize=2, error_kw={"lw": 1, "ecolor": INK})
        ax.set(yscale="log", xticks=np.arange(len(ps)), xticklabels=[f"p = {p}" for p in ps], ylabel="milliseconds", title=title)
        ax.grid(axis="x", visible=False)
    axes[0].legend(loc="upper left", fontsize=8)
    pairs = " / ".join(f"{v2['timing'][p]['decoders']['relay']['pairs']:,}" for p in ps)
    fig.text(0.01, 0.005, f"Fresh timing shots (seed 8): one worker, mains power, nothing else running; {pairs} pairs. "
             "Pair time = X decode + Z decode.\nMean: 95% bootstrap intervals. p99 rests on 5–20 shots.", fontsize=8, color=MUTED)
    save(fig, "v2_latency.png", caption_lines=2)


def v2_tradeoff(v2):
    """Accuracy against speed at each p: LER from the test shots, mean time from the timing shots."""
    ps = sorted(v2["sweep"], key=float)
    fig, axes = plt.subplots(1, len(ps), figsize=(4.3 * len(ps), 4.1))
    for ax, p in zip(axes, ps):
        for key, (label, color, marker) in V2_STYLE.items():
            d, t = v2["sweep"][p]["decoders"][key], v2["timing"][p]["decoders"][key]
            low, high = d["ler_ci95"]
            tlow, thigh = t["ms_mean_ci95"]
            ax.errorbar(t["ms_mean"], d["ler"], yerr=[[d["ler"] - low], [high - d["ler"]]],
                        xerr=[[t["ms_mean"] - tlow], [thigh - t["ms_mean"]]], color=color, marker=marker, ms=8, lw=1.2,
                        capsize=2, label=label, markeredgecolor=SURFACE)
        ax.set(xscale="log", yscale="log", xlabel="mean decode time per shot pair (ms)", title=f"p = {p}")
        plain_log_ticks(ax.xaxis)
    axes[0].set_ylabel("logical error rate per cycle")
    axes[-1].legend(fontsize=8, loc="upper right")
    fig.text(0.01, 0.005, "Lower left is better. Error rate: fresh test shots (seed 7). Time: fresh single-worker timing shots (seed 8). "
             "Bars: 95% intervals.", fontsize=8, color=MUTED)
    save(fig, "v2_tradeoff.png", caption_lines=1)


def main():
    report = json.loads((REPORTS / "evaluation.json").read_text())
    ler_vs_p(report)
    latency(report)
    pareto(report)
    routing(report)
    loss(report)
    calibration()
    v2_path = REPORTS / "v2_evaluation.json"
    if v2_path.exists():
        v2 = json.loads(v2_path.read_text())
        if v2.get("sweep"):
            v2_ler_vs_p(v2)
        if v2.get("sweep") and v2.get("timing"):
            v2_latency(v2)
            v2_tradeoff(v2)


if __name__ == "__main__":
    main()
