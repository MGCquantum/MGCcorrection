"""Write docs/RESULTS.md from the stored reports, so no number in it is typed by hand.

  python -m aegis.report
"""
import json

from .paths import ROOT

from .train import REPORTS

OUT = ROOT / "docs" / "RESULTS.md"
ORDER = ["bposd", "relay", "bposd (flags ignored)", "relay (flags ignored)", "bposd+flags", "relay+flags", "tier 1 alone",
         "tier 2 alone", "bp200 -> relay (rule)", "rule (no ML)", "heuristic", "aegis, no loss features", "aegis",
         "aegis (online)", "aegis (accuracy mode)"]
LABEL = {"bposd": "BP-OSD", "relay": "relay-BP", "bposd (flags ignored)": "BP-OSD, flags ignored",
         "relay (flags ignored)": "relay-BP, flags ignored", "bposd+flags": "BP-OSD with flags", "relay+flags": "relay-BP with flags",
         "tier 1 alone": "tier 1 alone", "tier 2 alone": "tier 2 alone", "bp200 -> relay (rule)": "plain BP → relay-BP (team rule)",
         "rule (no ML)": "tier 1 → tier 2, no ML", "heuristic": "tier 1 → tier 2, one-feature heuristic",
         "aegis, no loss features": "QEC-Aegis without loss features (cached)", "aegis": "QEC-Aegis (cached policy)",
         "aegis (online)": "**QEC-Aegis (online)**", "aegis (accuracy mode)": "QEC-Aegis, accuracy mode (cached)"}


def load(name):
    path = REPORTS / name
    return json.loads(path.read_text()) if path.exists() else None


def ms(v):
    return f"{v:,.0f}" if v >= 100 else f"{v:.1f}"


def decoder_table(result):
    lines = ["| Decoder | Failures X, Z | Pair failures | LER per cycle | 95% interval | Mean ms | Median ms | p95 ms | p99 ms | Pairs/s | Tier 2 used |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    for key in ORDER:
        d = result["decoders"].get(key)
        if d is None:
            continue
        esc = f"{100 * d['escalated_fraction']:.2f}%" if "escalated_fraction" in d else ""
        lines.append(f"| {LABEL[key]} | {d['failures_X']}, {d['failures_Z']} | {d['failures_pair']} of {d['pairs']:,} | {d['ler']:.2e} | "
                     f"{d['ler_ci95'][0]:.2e} – {d['ler_ci95'][1]:.2e} | {ms(d['ms_mean'])} | {ms(d['ms_median'])} | {ms(d['ms_p95'])} | "
                     f"{ms(d['ms_p99'])} | {d['pairs_per_second']:.1f} | {esc} |")
    return lines


def comparison_table(result):
    lines = ["| Comparison (same shots) | LER ratio | 95% interval | Fails only A / only B | McNemar p | Mean-time speedup | 95% interval |",
             "|---|---|---|---|---|---|---|"]
    for name, c in result["comparisons"].items():
        ratio = "n/a" if c["ler_ratio"] is None else f"{c['ler_ratio']:.2f}"
        ci = "n/a" if not c["ler_ratio_ci95"] else f"{c['ler_ratio_ci95'][0]:.2f} – {c['ler_ratio_ci95'][1]:.2f}"
        lines.append(f"| {name} | {ratio} | {ci} | {c['only_a_fails']} / {c['only_b_fails']} | {c['mcnemar_p']:.3g} | "
                     f"{c['speedup_mean']:.2f}× | {c['speedup_mean_ci95'][0]:.2f} – {c['speedup_mean_ci95'][1]:.2f} |")
    return lines


def routing_table(settings):
    lines = ["| Setting | Shots | Tier 2 used | Tier 1 not converged | Flagged by model | Hidden failures | Caught | Fixed by tier 2 | Needless escalations |",
             "|---|---|---|---|---|---|---|---|---|"]
    for setting, result in settings.items():
        d = result["decoders"]["aegis"]
        lines.append(f"| {setting} | {d['shots']:,} | {100 * d['escalated_fraction']:.2f}% | {d['unconverged']} | {d['flagged_by_model']} | "
                     f"{d['hidden_failures']} | {d['hidden_failures_caught']} | {d['fixed_by_tier2']} | {d['needless']} |")
    return lines


REQUIRED = [("bposd", "BP-OSD"), ("relay", "relay-BP"), ("aegis (online)", "QEC-Aegis")]


def span(values, fmt):
    lo, hi = min(values), max(values)
    return fmt.format(lo) if fmt.format(lo) == fmt.format(hi) else f"{fmt.format(lo)}–{fmt.format(hi)}"


def required_evaluation(ev, res):
    """The Challenge 1 required sweep in one place: LER, latency and resources of QEC-Aegis and both baselines."""
    out = ["## Challenge 1 required evaluation: sweep over p = 0.003, 0.004, 0.005", "",
           "Same test data and noise conditions: at each p, all three decoders decode the identical frozen test shots (seed 2)",
           "of the kit's Gross-code memory circuits at that p, in X and Z memory, scored on the same X/Z pairs. Latency is from",
           "separate single-worker timing shots (seed 5) with nothing else running; the contended column is the mean time on",
           "the test shots, decoded with 8 parallel workers. QEC-Aegis is the online routed decoder run as one program.", "",
           "| p | Decoder | Test pairs | Failed pairs | LER per cycle | 95% interval | Mean ms | Median ms | p95 ms | p99 ms | Pairs/s | Mean ms, contended | Tier 2 used |",
           "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for p, sweep in ev["sweep"].items():
        timing = ev.get("timing", {}).get(p, {"decoders": {}})["decoders"]
        for key, label in REQUIRED:
            d, t = sweep["decoders"].get(key), timing.get(key)
            if d is None:
                continue
            lat = f"{ms(t['ms_mean'])} | {ms(t['ms_median'])} | {ms(t['ms_p95'])} | {ms(t['ms_p99'])} | {t['pairs_per_second']:.1f}" if t \
                else " | | | | "
            esc = f"{100 * d['escalated_fraction']:.2f}%" if "escalated_fraction" in d else ""
            out.append(f"| {p} | {label} | {d['pairs']:,} | {d['failures_pair']} | {d['ler']:.2e} | {d['ler_ci95'][0]:.2e} – {d['ler_ci95'][1]:.2e} | "
                       f"{lat} | {ms(d['ms_mean'])} | {esc} |")
    out += ["", "QEC-Aegis against each baseline on the same pairs (LER: test shots; speedup of the mean: single-worker timing shots):", "",
            "| p | Baseline | LER ratio QEC-Aegis / baseline | 95% interval | Fail only QEC-Aegis / only baseline | McNemar p | Speedup | 95% interval |",
            "|---|---|---|---|---|---|---|---|"]
    for p, sweep in ev["sweep"].items():
        for key, label in REQUIRED[:2]:
            c = sweep["comparisons"].get(f"aegis (online) vs {key}")
            t = ev.get("timing", {}).get(p, {"comparisons": {}})["comparisons"].get(f"aegis (online) vs {key}")
            if c is None:
                continue
            speed = f"{t['speedup_mean']:.2f}× | {t['speedup_mean_ci95'][0]:.2f} – {t['speedup_mean_ci95'][1]:.2f}" if t else " | "
            ratio = "n/a | n/a" if c["ler_ratio"] is None else f"{c['ler_ratio']:.2f} | {c['ler_ratio_ci95'][0]:.2f} – {c['ler_ratio_ci95'][1]:.2f}"
            out.append(f"| {p} | {label} | {ratio} | "
                       f"{c['only_a_fails']} / {c['only_b_fails']} | {c['mcnemar_p']:.3g} | {speed} |")
    out.append("")
    if res:
        m = res["machine"]
        out += ["### Decoder resource requirements (`python -m aegis.resources`)", "",
                f"One decoder per fresh process, numerical libraries single-threaded, on {m.get('chip') or m['platform']} "
                f"({m['cores']} cores{', %d GB' % m['memory_gb'] if m.get('memory_gb') else ''}, {m['platform']}). Figures are specific to this machine; "
                "`RESOURCES=1 scripts/verify_aegis.sh` re-measures them. "
                "Ranges are over p = 0.003–0.005 and X/Z memory. Peak memory is the whole Python process, including the circuit,",
                "detector error model and check matrix (problem alone shown separately); *added* is what building the decoder and",
                "decoding adds on top (for QEC-Aegis this includes the scikit-learn library). QEC-Aegis holds two relay-BP instances (tier 1 and tier 2), the order-0 BP-OSD second opinion",
                "used by tier-1 features, and the risk model. Setup excludes the one-time scikit-learn import, shown separately.", "",
                "| Decoder | Components | Check matrix (checks × mechanisms) | One-time import s | Setup s | Problem MB | Peak MB | Added MB | Model on disk | Model inference per shot |",
                "|---|---|---|---|---|---|---|---|---|---|"]
        for key, label in REQUIRED:
            rows = [r for r in res["rows"] if r["decoder"] == key.split(" ")[0]]
            if not rows:
                continue
            model = f"{rows[0]['model_kb']:.0f} kB" if rows[0]["model_kb"] else "none"
            infer = span([r["inference_us"] for r in rows], "{:.0f} µs") if rows[0]["inference_us"] else "none"
            out.append(f"| {label} | {rows[0]['parts']} | {span([r['checks'] for r in rows], '{:,}')} × {span([r['mechanisms'] for r in rows], '{:,}')} | "
                       f"{span([r['import_s'] for r in rows], '{:.2f}') if rows[0].get('import_s') else 'none'} | "
                       f"{span([r['decoder_setup_s'] for r in rows], '{:.2f}')} | {span([r['problem_peak_mb'] for r in rows], '{:.0f}')} | "
                       f"{span([r['peak_mb'] for r in rows], '{:.0f}')} | {span([r['decoder_added_mb'] for r in rows], '{:.0f}')} | {model} | {infer} |")
        out.append("")
    return out


V2_ROWS = [("bposd", "BP-OSD"), ("relay", "relay-BP"), ("aegis v1 (online)", "QEC-Aegis v1"),
           ("aegis v2 speed (online)", "QEC-Aegis v2, speed"), ("aegis v2 accuracy (online)", "QEC-Aegis v2, accuracy")]


def v2_section(v2):
    """QEC-Aegis v2 (aegis.retune) on fresh shots (aegis.evaluate_v2)."""
    out = ["## QEC-Aegis v2 on fresh shots (seed 7 test, seed 8 timing)", "",
           "v2 was designed after the v1 results above were known: it keeps v1's fitted risk models and chooses, for each noise",
           "setting separately and on validation shots only, the second tier (relay-BP or the larger `strong10` ensemble) and the",
           "threshold (`python -m aegis.retune`; hashes frozen in `experiments/reports/v2_frozen.json` before any fresh shot was",
           "decoded). Because the seed-2 test shots informed that design, v2 is scored only on fresh shots, together with both",
           "baselines and v1 run again on the same shots. The risk model is now evaluated by a compiled tree walk that returns",
           "exactly scikit-learn's value; v1 on fresh shots uses it too, so its times here are lower than in the tables above.", "",
           "Latency comes from the single-worker timing shots, all decoded on mains power with nothing else running (timing",
           "entries first decoded on battery in Low Power Mode were discarded and decoded again). The contended 8-worker times",
           "of the test shots at p = 0.005 and under erasure were taken on battery in Low Power Mode, and the X-basis p = 0.004",
           "accuracy-mode run spans a hibernation; use those columns only for comparisons within one setting. Failure counts do",
           "not depend on machine speed.", ""]
    selection = v2.get("selection", {}).get("settings", {})
    if selection:
        out += ["### Operating points chosen on validation shots", "",
                "| Setting | Mode | Tier 2 | Threshold | Validation failed pairs (relay-BP) | Validation mean ms (relay-BP) | Tier 2 used |",
                "|---|---|---|---|---|---|---|"]
        for setting, s in selection.items():
            for mode, c in s["chosen"].items():
                if c:
                    out.append(f"| {setting} | {mode} | {c['tier2']} | {c['threshold']:.2e} | {c['failures_pair']} ({s['relay_failures']}) | "
                               f"{c['ms_mean']:.1f} ({s['relay_ms']:.1f}) | {100 * c['escalated']:.2f}% |")
                else:
                    out.append(f"| {setting} | {mode} | none feasible | | | | |")
        out.append("")
    if v2.get("sweep"):
        out += ["### Sweep over p: fresh test shots (LER) and fresh single-worker timing shots (latency)", "",
                "| p | Decoder | Test pairs | Failed pairs | LER per cycle | 95% interval | Mean ms | Median ms | p95 ms | p99 ms | Pairs/s | Mean ms, contended | Tier 2 used |",
                "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for p, sweep in v2["sweep"].items():
            timing = v2.get("timing", {}).get(p, {"decoders": {}})["decoders"]
            for key, label in V2_ROWS:
                d, t = sweep["decoders"].get(key), timing.get(key)
                if d is None:
                    continue
                lat = f"{ms(t['ms_mean'])} | {ms(t['ms_median'])} | {ms(t['ms_p95'])} | {ms(t['ms_p99'])} | {t['pairs_per_second']:.1f}" if t \
                    else " | | | | "
                esc = f"{100 * d['escalated_fraction']:.2f}%" if "escalated_fraction" in d else ""
                out.append(f"| {p} | {label} | {d['pairs']:,} | {d['failures_pair']} | {d['ler']:.2e} | {d['ler_ci95'][0]:.2e} – {d['ler_ci95'][1]:.2e} | "
                           f"{lat} | {ms(d['ms_mean'])} | {esc} |")
        out += ["", "Paired comparisons (LER: fresh test shots; speedup of the mean: fresh single-worker timing shots):", "",
                "| p | Comparison | LER ratio | 95% interval | Fail only first / only second | McNemar p | Speedup | 95% interval |",
                "|---|---|---|---|---|---|---|---|"]
        for p, sweep in v2["sweep"].items():
            timing = v2.get("timing", {}).get(p, {"comparisons": {}})["comparisons"]
            for name, c in sweep["comparisons"].items():
                t = timing.get(name)
                ratio = "n/a | n/a" if c["ler_ratio"] is None else f"{c['ler_ratio']:.2f} | {c['ler_ratio_ci95'][0]:.2f} – {c['ler_ratio_ci95'][1]:.2f}"
                speed = f"{t['speedup_mean']:.2f}× | {t['speedup_mean_ci95'][0]:.2f} – {t['speedup_mean_ci95'][1]:.2f}" if t else " | "
                out.append(f"| {p} | {name.replace(' (online)', '')} | {ratio} | {c['only_a_fails']} / {c['only_b_fails']} | {c['mcnemar_p']:.3g} | {speed} |")
        out.append("")
    if v2.get("loss"):
        out += ["### Heralded erasure at p = 0.004 (fresh test shots, 8 workers)", "",
                "| f | Decoder | Pairs | Failed pairs | LER per cycle | 95% interval | Mean ms, contended | p99 ms, contended | Tier 2 used |",
                "|---|---|---|---|---|---|---|---|---|"]
        for f, result in v2["loss"].items():
            for key, label in [("bposd+flags", "BP-OSD with flags"), ("relay+flags", "relay-BP with flags")] + V2_ROWS[2:]:
                d = result["decoders"].get(key)
                if d is None:
                    continue
                esc = f"{100 * d['escalated_fraction']:.2f}%" if "escalated_fraction" in d else ""
                out.append(f"| {f} | {label} | {d['pairs']:,} | {d['failures_pair']} | {d['ler']:.2e} | {d['ler_ci95'][0]:.2e} – {d['ler_ci95'][1]:.2e} | "
                           f"{ms(d['ms_mean'])} | {ms(d['ms_p99'])} | {esc} |")
        out += ["", "| f | Comparison | LER ratio | 95% interval | Fail only first / only second | McNemar p | Speedup (contended) |", "|---|---|---|---|---|---|---|"]
        for f, result in v2["loss"].items():
            for name, c in result["comparisons"].items():
                ratio = "n/a | n/a" if c["ler_ratio"] is None else f"{c['ler_ratio']:.2f} | {c['ler_ratio_ci95'][0]:.2f} – {c['ler_ratio_ci95'][1]:.2f}"
                out.append(f"| {f} | {name.replace(' (online)', '')} | {ratio} | {c['only_a_fails']} / {c['only_b_fails']} | {c['mcnemar_p']:.3g} | {c['speedup_mean']:.2f}× |")
        out.append("")
    return out


def main():
    ev = load("evaluation.json")
    tr = load("training.json")
    res = load("resources.json")
    out = ["# Results", "",
           "Generated by `python -m aegis.report` from `experiments/reports/*.json`. Every number is a measurement from this",
           "repository's runs on one machine (Apple M5, 10 cores, 16 GB). Run details are in `experiments/manifest.json`.", "",
           "Conventions, as in the starter kit's `analyze.py`: X and Z records that share a seed share Stim's random stream, so",
           "shot k of X memory is paired with shot `analyze.z_partner(n)[k]` of Z memory (a fixed random derangement), never with",
           "Z shot k. A pair fails when either shot fails, the logical error rate (LER) per cycle is 1 − (1 − P)^(1/12), and a pair's",
           "decode time is the X time plus its Z partner's time. Every decoder compared on one setting uses the same pairs.",
           "Intervals are 95%: exact Clopper–Pearson for failure rates, paired bootstrap for ratios and mean times.", ""]
    if ev and ev.get("sweep"):
        out += required_evaluation(ev, res)
    v2 = load("v2_evaluation.json")
    if v2 and (v2.get("sweep") or v2.get("loss")):
        out += v2_section(v2)
    if tr:
        chosen = tr["chosen"]
        out += ["## Chosen system (fixed on validation shots, before the test shots were decoded)", "",
                "Selection-time numbers from `experiments/reports/training.json`. That selection paired X shot k with Z shot k;",
                "the models and thresholds are frozen (`experiments/reports/frozen_models.json`) and were not refit after the",
                "pairing fix. Per-shot quantities (AUC, calibration) do not depend on pairing.", ""]
        for mode, c in chosen.items():
            out.append(f"- **{mode}**: `{c['tier1']}` → `{c['tier2']}`, risk model `{c['model']}`, threshold {c['threshold']:.2e} "
                       f"({c['failures']} validation pair failures at selection time, {c['mean_ms']:.0f} ms mean over the three p).")
        out.append("")
    rc = load("validation_recheck.json")
    if rc:
        out += ["### Frozen choice re-checked with independent X/Z pairs (`python -m aegis.recheck`)", "",
                "Same models, same thresholds, validation shots only, pairs as in the tables below.", "",
                "| Mode | Threshold | Validation pair failures | relay-BP pair failures | Mean ms (average over p) | Selection rule | Still holds |",
                "|---|---|---|---|---|---|---|"]
        for mode, r in rc["modes"].items():
            out.append(f"| {mode} | {r['threshold']:.2e} | {r['failures']} | {r['relay_failures']} | {r['mean_ms']:.1f} | "
                       f"{r['rule']} | {'yes' if r['rule_holds'] else '**no**'} |")
        out.append("")
    if ev and ev.get("timing"):
        out += ["## Latency benchmark: one worker, nothing else running", "",
                "Separate shots (seed 5). Use this table for decode times. Its shot counts are too small for error rates.", ""]
        for p, result in ev["timing"].items():
            out += [f"### p = {p}", ""] + decoder_table(result) + [""]
            keep = {k: v for k, v in result["comparisons"].items() if k.endswith("vs relay") or k.endswith("vs bposd")}
            out += comparison_table({"comparisons": keep}) + [""]
    if ev and ev.get("sweep"):
        out += ["## Required sweep: frozen test shots (seed 2)", "",
                "Use this table for error rates. It was decoded with 8 parallel workers, so absolute times are inflated by",
                "contention; ratios between decoders on the same shots remain meaningful.",
                "Rows marked *cached* combine the cached per-shot answers and times of the tiers. The *online* row is the routed",
                "decoder run as one program on the same shots.", ""]
        for p, result in ev["sweep"].items():
            out += [f"### p = {p}", ""] + decoder_table(result) + [""] + comparison_table(result) + [""]
            if "online_agrees_with_cached" in result:
                a = result["online_agrees_with_cached"]
                out += [f"Online decoder against cached policy, shot by shot: same routing decision on {100 * a['decisions']:.2f}% of shots, same outcome on {100 * a['failures']:.2f}%.", ""]
        out += ["### What the router did (cached policy, both bases pooled)", ""] + \
            routing_table({f"p = {p}": r for p, r in ev["sweep"].items()}) + [""]
        out += ["Hidden failure: tier 1 converged but its answer is logically wrong. Needless escalation: the model sent a correct tier-1 answer to tier 2.", ""]
        out += ["### Risk model on test shots", "", "| p | Converged tier-1 shots | Wrong | AUC | Average precision | Brier | ECE | Mean predicted risk | Observed rate |", "|---|---|---|---|---|---|---|---|---|"]
        for p, result in ev["sweep"].items():
            q = result["model_quality"]
            if "auc" in q:
                out.append(f"| {p} | {q['shots']:,} | {q['wrong']} | {q['auc']:.4f} | {q['average_precision']:.3f} | {q['brier']:.2e} | {q['ece']:.2e} | {q['mean_risk']:.2e} | {q['base_rate']:.2e} |")
            else:
                out.append(f"| {p} | {q['shots']:,} | {q['wrong']} | n/a | n/a | n/a | n/a | n/a | n/a |")
        out.append("")
    if ev and ev.get("loss"):
        out += ["## Heralded erasure at p = 0.004", "",
                "Simplified heralded-erasure model (`challenge-1-ml-decoder-kit/lossy.py`), not a full neutral-atom loss model.",
                "A fraction f of every depolarizing channel becomes a flagged erasure. All rows of one f decode the same shots.", ""]
        for f, result in ev["loss"].items():
            out += [f"### f = {f}", ""] + decoder_table(result) + [""] + comparison_table(result) + [""]
    if tr:
        out += ["## Model comparison on validation shots", "",
                "Ranking quality of every candidate risk model (all three p pooled, converged tier-1 shots only), and the measured time of one per-shot call.", "",
                "| Tier 1 | Model | AUC | Average precision | ECE | Inference µs |", "|---|---|---|---|---|---|"]
        for key, q in tr["ranking"].items():
            tier1, name = key.split(" | ")
            out.append(f"| {tier1} | {name} | {q.get('auc', float('nan')):.4f} | {q.get('average_precision', float('nan')):.3f} | {q.get('ece', float('nan')):.2e} | {q['inference_us']:.0f} |")
        out += ["", "### End-to-end selection (speed mode: no more validation failures than relay-BP at any p)", "",
                "As recorded at selection time (X shot k paired with Z shot k).", "",
                "| System | Threshold | Validation pair failures (all p) | Mean ms (average over p) |", "|---|---|---|---|"]
        for key, s in sorted(tr["systems"].items(), key=lambda kv: kv[1]["speed"]["mean_ms"] if kv[1]["speed"] else 1e9):
            if s["speed"]:
                out.append(f"| {key} | {s['speed']['threshold']:.1e} | {s['speed']['failures']} | {s['speed']['mean_ms']:.1f} |")
            else:
                out.append(f"| {key} | none feasible | | |")
        out += ["", "### Generalization across noise strengths (AUC of a gradient-boosted model)", "",
                "| Trained on | " + " | ".join(next(iter(tr["cross_noise_auc"].values())).keys()) + " |",
                "|---|" + "---|" * len(next(iter(tr["cross_noise_auc"].values())))]
        for key, row in tr["cross_noise_auc"].items():
            out.append(f"| {key} | " + " | ".join("n/a" if v is None else f"{v:.4f}" for v in row.values()) + " |")
        out.append("")
    for p in ("0.003", "0.004", "0.005"):
        study = load(f"complementarity_p{p}.json")
        if not study:
            continue
        out += [f"## Decoder complementarity at p = {p} (validation, {study['pairs']:,} pairs)", "",
                "| BP-OSD vs relay-BP, per shot | Shots | BP-OSD ms | relay-BP ms |", "|---|---|---|---|"]
        for label, cell in study["paired_outcomes_bposd_relay"].items():
            a, b = cell.get("bposd_ms"), cell.get("relay_ms")
            out.append(f"| {label} | {cell['shots']} | {'' if a is None else ms(a)} | {'' if b is None else ms(b)} |")
        out += ["", "| Decoder or rule | Pair failures | LER per cycle | Mean ms | p99 ms | Tier 2 used |", "|---|---|---|---|---|---|"]
        for group in ("tiers", "bposd_relay_routing", "rule_based"):
            for name, r in study[group].items():
                esc = f"{100 * r['escalated']:.1f}%" if "escalated" in r else ""
                out.append(f"| {name} | {r['failures_pair']} | {r['ler']:.2e} | {ms(r['ms_mean'])} | {ms(r['ms_p99'])} | {esc} |")
        out += ["", "Wrong answers hidden behind a converged first stage: " +
                "; ".join(f"`{n}` {r['converged_but_wrong']} of {r['converged']:,}" for n, r in study["hidden_failures"].items()) + ".", ""]
    pre = load("predecoder_p0.004.json")
    if pre:
        out += ["## Approach B, rejected: learned predecoder (validation, X basis, p = 0.004)", "",
                f"{pre['shots']:,} shots. The predecoder commits {pre['committed_per_shot']:.1f} mechanisms per shot at confidence above {pre['commit_level']}.", "",
                "| Variant | Failures | Not converged | Mean ms | Mean BP iterations |", "|---|---|---|---|---|"]
        names = {"tier 1": "tier 1 alone", "soft": "learned priors, then tier 1", "hard": "commit confident mechanisms, tier 1 on the residual"}
        for key, r in pre["results"].items():
            out.append(f"| {names[key]} | {r['failed']} | {r['unconverged']} | {r['ms_mean']:.1f} | {r['iterations_mean']:.0f} |")
        out.append("")
    if ev and ev.get("runs"):
        out += ["## Resources", "", "| Record | Shots | Tiers | Workers | Wall s | CPU s | Peak worker memory MB |", "|---|---|---|---|---|---|---|"]
        for run in ev["runs"]:
            if run["split"] in ("test", "timing", "val"):
                out.append(f"| {run['record'].split('/')[-1]} | {run['shots']:,} | {' '.join(run['tiers'])} | {run['workers']} | {run['wall_seconds']:,.0f} | "
                           f"{run['cpu_seconds']:,.0f} | {run['peak_worker_rss_mb']:.0f} |")
        out.append("")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(out))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
