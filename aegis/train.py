"""Train, calibrate and select the risk model. Test records are never read here.

  python -m aegis.train            the required sweep (p = 0.003, 0.004, 0.005)
  python -m aegis.train --loss     the heralded-erasure settings (p = 0.004, f = 0.25, 0.5, 0.75)

  train (seed 1)    fit the models on tier-1 records: features -> tier-1 answer wrong
  calib (seed 4)    Platt-scale every model's scores into probabilities
  val   (seed 3)    compare systems end to end and choose the tiers, the model and its threshold

A system is (tier 1, tier 2, risk model, threshold). Candidates: two first tiers (`fast`, `relay1`),
two second tiers (`relay`, `strong10`), and as risk model single-feature heuristics, logistic
regression, gradient-boosted trees and gradient-boosted trees with feature groups removed.

Selection is by the end-to-end result on validation shots, not by classification accuracy:

  speed mode     lowest mean decode time among systems that fail on no more validation pairs
                 than relay-BP at every p. For each system the threshold is the largest that
                 satisfies this.
  accuracy mode  fewest validation failures among systems that are no slower than relay-BP on
                 average at every p. For each system the threshold is the smallest that satisfies this.

Model inference time, measured per shot, is part of every decode time.
Writes models/*.joblib and results/training*.json.
"""
import argparse
import json
import time

import joblib
import numpy as np

from .paths import MODELS, REPORTS

from . import features
from .collect import RECORDS, TRAIN_RECORDS, load
from .model import CONVERGED, calibrate, quality, train
from .policy import clopper_pearson, frontier, pair_failures, pair_seconds, pareto

SWEEP = [0.003, 0.004, 0.005]
THRESHOLDS = np.concatenate([[0.0], np.geomspace(1e-5, 0.5, 60), [0.75, 1.0]])
TIER1, TIER2 = ["fast", "relay1"], ["relay", "strong10"]
CANDIDATES = {
    "heuristic: solution weight": dict(kind="heuristic", feature="solution_weight"),
    "heuristic: iterations": dict(kind="heuristic", feature="log_iterations"),
    "heuristic: syndrome weight": dict(kind="heuristic", feature="syndrome_weight"),
    "heuristic: second opinion disagrees": dict(kind="heuristic", feature="second_disagrees"),
    "logistic": dict(kind="logistic"),
    "gbm": dict(kind="gbm"),
    "logistic, no second opinion": dict(kind="logistic", groups=("tier1", "syndrome", "temporal", "loss")),
    "logistic, no temporal features": dict(kind="logistic", groups=("tier1", "syndrome", "loss", "second")),
    "logistic, no tier-1 diagnostics": dict(kind="logistic", groups=("syndrome", "temporal", "loss", "second")),
    "logistic, syndrome only": dict(kind="logistic", groups=("syndrome", "temporal")),
    "logistic, no loss features": dict(kind="logistic", groups=("tier1", "syndrome", "temporal", "second")),
    "gbm, no second opinion": dict(kind="gbm", groups=("tier1", "syndrome", "temporal", "loss")),
    "gbm, no loss features": dict(kind="gbm", groups=("tier1", "syndrome", "temporal", "second")),
}
LEARNED = ["logistic", "gbm"]


def name_of(split, basis, p, f):
    return f"{split}_{basis}_p{p}" + (f"_f{f}" if f else "") + ".npz"


def read(directory, split, settings, tier):
    """Stacked (features, labels, setting index) of a split over (p, f) settings and both bases."""
    F, y, where = [], [], []
    for k, (p, f) in enumerate(settings):
        for basis in "XZ":
            path = directory / name_of(split, basis, p, f)
            if path.exists():
                record = load(path)
                F.append(record[tier]["features"])
                y.append(record[tier]["failed"])
                where.append(np.full(len(y[-1]), k))
    return np.concatenate(F), np.concatenate(y), np.concatenate(where)


def inference_seconds(model, F, repeats=1000):
    """Measured time of one per-shot risk call."""
    rows = F[np.random.default_rng(0).integers(0, len(F), repeats)]
    start = time.perf_counter()
    for row in rows:
        model.risk(row)
    return (time.perf_counter() - start) / repeats


def validation_frontiers(model, settings, tier1, tier2, overhead):
    """Per setting: the threshold sweep of the routed decoder on validation records, next to relay-BP."""
    out = {}
    flags = "+flags" if "+flags" in tier1 else ""
    for p, f in settings:
        x, z = (load(RECORDS / name_of("val", basis, p, f)) for basis in "XZ")
        points = frontier(x, z, model.risks(x[tier1]["features"]), model.risks(z[tier1]["features"]), THRESHOLDS,
                          tier1, tier2, overhead)
        relay = "relay" + flags
        out[f"p={p} f={f}"] = {"points": points, "relay_failures": int(pair_failures(x[relay]["failed"], z[relay]["failed"]).sum()),
                               "relay_ms": float(pair_seconds(x[relay]["seconds"], z[relay]["seconds"]).mean() * 1e3),
                               "pairs": len(x["observables"])}
    return out


def operating_points(fronts):
    """(speed, accuracy) thresholds of one system, or None where its constraint cannot be met."""
    ks = range(len(THRESHOLDS))
    no_worse = [k for k in ks if all(fr["points"][k]["failures_pair"] <= fr["relay_failures"] for fr in fronts.values())]
    no_slower = [k for k in ks if all(fr["points"][k]["ms_mean"] <= fr["relay_ms"] for fr in fronts.values())]

    def describe(k):
        return {"threshold": float(THRESHOLDS[k]),
                "failures": int(sum(fr["points"][k]["failures_pair"] for fr in fronts.values())),
                "mean_ms": float(np.mean([fr["points"][k]["ms_mean"] for fr in fronts.values()])),
                "per_setting": {s: fr["points"][k] | {"relay_failures": fr["relay_failures"], "relay_ms": fr["relay_ms"]}
                                for s, fr in fronts.items()}}
    speed = describe(max(no_worse)) if no_worse else None
    # Fewest failures among the no-slower thresholds; ties go to the faster (larger) threshold.
    accuracy = describe(min(no_slower, key=lambda k: (sum(fr["points"][k]["failures_pair"] for fr in fronts.values()), -k))) \
        if no_slower else None
    return speed, accuracy


def reliability(model, F, y, bins=8):
    """Predicted against observed risk in equal-count bins of the converged shots."""
    keep = F[:, CONVERGED] > 0
    risk, y = model.risks(F[keep]), np.asarray(y[keep], bool)
    order = np.argsort(risk)
    # Finer bins at the risky end, where the routing decision is made.
    edges = np.unique((len(risk) * (1 - np.geomspace(1, 1e-3, bins + 1))).astype(int))
    parts = [order[a:b] for a, b in zip(edges[:-1], edges[1:]) if b > a] + [order[edges[-1]:]]
    parts = [part for part in parts if len(part)]
    return {"predicted": [float(risk[part].mean()) for part in parts], "observed": [float(y[part].mean()) for part in parts],
            "observed_ci95": [list(clopper_pearson(int(y[part].sum()), len(part))) for part in parts],
            "shots": [int(len(part)) for part in parts]}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--loss", action="store_true", help="train for the heralded-erasure settings")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--p", type=float, nargs="+", default=SWEEP, help="noise strengths of the sweep (default: all three)")
    parser.add_argument("--dry-run", action="store_true", help="print the comparison, write nothing")
    args = parser.parse_args()
    suffix, flags = ("_loss", "+flags") if args.loss else ("", "")
    settings = [(0.004, f) for f in (0.25, 0.5, 0.75)] if args.loss else [(p, 0.0) for p in args.p]
    have_val = all((RECORDS / name_of("val", b, p, f)).exists() for p, f in settings for b in "XZ")
    report = {"settings": settings, "features": features.NAMES, "systems": {}, "ranking": {}, "cross_noise_auc": {}}
    fitted, best = {}, {"speed": None, "accuracy": None, "heuristic": None}

    for tier1 in (t + flags for t in TIER1):
        F, y, where = read(TRAIN_RECORDS, "train", settings, tier1)
        Fc, yc, _ = read(TRAIN_RECORDS, "calib", settings, tier1)
        Fv, yv, wv = read(RECORDS, "val", settings, tier1) if have_val else (Fc, yc, _)
        conv = F[:, CONVERGED] > 0
        print(f"\ntier 1 = {tier1}: train {len(y)} shots, {int(conv.sum())} converged, {int((y & conv).sum())} of them wrong; "
              f"calibration {len(yc)}; validation {len(yv)}")
        for name, spec in CANDIDATES.items():
            model = calibrate(train(F, y, seed=args.seed, **spec), Fc, yc)
            overhead = inference_seconds(model, Fv)
            model.meta |= {"name": name, "tier1": tier1, "inference_seconds": overhead, "seed": args.seed,
                           "feature_names": features.NAMES, "trained_on": settings}
            fitted[(tier1, name)] = model
            q = quality(model, Fv, yv)
            report["ranking"][f"{tier1} | {name}"] = q | {"inference_us": overhead * 1e6, "per_setting": {
                f"p={p} f={f}": quality(model, Fv[wv == i], yv[wv == i]) for i, (p, f) in enumerate(settings)}}
            line = f"  {name:30s} AUC {q.get('auc', float('nan')):.4f}  AP {q.get('average_precision', float('nan')):.3f}  " \
                   f"ECE {q.get('ece', float('nan')):.5f}  {overhead * 1e6:5.0f} us"
            if have_val:
                for tier2 in (t + flags for t in TIER2):
                    fronts = validation_frontiers(model, settings, tier1, tier2, overhead)
                    speed, accuracy = operating_points(fronts)
                    key = f"{tier1} -> {tier2} | {name}"
                    report["systems"][key] = {"speed": speed, "accuracy": accuracy,
                                              "pareto": {s: pareto(fr["points"]) for s, fr in fronts.items()}}
                    kind = "heuristic" if name.startswith("heuristic") else "learned" if name in LEARNED else "ablation"
                    for mode, point in (("speed", speed), ("accuracy", accuracy)):
                        if point is None:
                            continue
                        score = (point["mean_ms"], point["failures"]) if mode == "speed" else (point["failures"], point["mean_ms"])
                        slot = mode if kind == "learned" else "heuristic" if (kind == "heuristic" and mode == "speed") else None
                        if slot and (best[slot] is None or score < best[slot][0]):
                            best[slot] = (score, tier1, tier2, name, point)
                    if speed:
                        line += f"  | {tier2}: thr {speed['threshold']:.1e} {speed['failures']} fail {speed['mean_ms']:.0f} ms"
            print(line)
        # Generalization across noise strengths: train at one setting, score at each.
        for i, (p, f) in enumerate(settings):
            single = calibrate(train(F[where == i], y[where == i], kind="gbm", seed=args.seed), Fc, yc)
            report["cross_noise_auc"][f"{tier1} | trained at p={p} f={f}"] = {
                f"p={q} f={g}": quality(single, Fv[wv == j], yv[wv == j]).get("auc") for j, (q, g) in enumerate(settings)}
        report["cross_noise_auc"][f"{tier1} | trained at all"] = {
            s: v.get("auc") for s, v in report["ranking"][f"{tier1} | gbm"]["per_setting"].items()}

    if args.dry_run:
        return
    MODELS.mkdir(exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    if have_val:
        files = {"speed": f"aegis_router{suffix}.joblib", "accuracy": f"aegis_router{suffix}_accuracy.joblib",
                 "heuristic": f"heuristic_router{suffix}.joblib"}
        report["chosen"] = {}
        for slot, file in files.items():
            if best[slot] is None:
                print(f"{slot}: no system satisfies the constraint on validation shots")
                continue
            _, tier1, tier2, name, point = best[slot]
            model = fitted[(tier1, name)]
            chosen = type(model)(**{**model.__dict__, "meta": model.meta | {"tier2": tier2, "threshold": point["threshold"], "mode": slot}})
            joblib.dump(chosen, MODELS / file)
            report["chosen"][slot] = {"tier1": tier1, "tier2": tier2, "model": name, "file": file} | point
            print(f"{slot:9s}: {tier1} -> {tier2}, {name}, threshold {point['threshold']:.2e}: "
                  f"{point['failures']} validation failures, {point['mean_ms']:.0f} ms mean  -> models/{file}")
            if slot == "speed":
                Fv, yv, _ = read(RECORDS, "val", settings, tier1)
                (REPORTS / f"calibration{suffix}.json").write_text(json.dumps(reliability(chosen, Fv, yv) | {"split": "validation"}, indent=1))
    else:
        # Without validation records (the erasure settings) the system chosen for the sweep is reused:
        # same tiers, same threshold on the calibrated risk, a model trained on the erasure data.
        base = joblib.load(MODELS / "aegis_router.joblib")
        tier1 = base.meta["tier1"] + flags
        model = fitted[(tier1, base.meta["name"])]
        model.meta |= {"tier2": base.meta["tier2"] + flags, "threshold": base.meta["threshold"], "mode": "speed",
                       "threshold_from": "sweep validation (aegis_router.joblib)"}
        joblib.dump(model, MODELS / f"aegis_router{suffix}.joblib")
        ablation = fitted[(tier1, base.meta["name"] + ", no loss features")]
        ablation.meta |= {"tier2": base.meta["tier2"] + flags, "threshold": base.meta["threshold"], "mode": "speed"}
        joblib.dump(ablation, MODELS / f"aegis_router{suffix}_no_loss_features.joblib")
        report["chosen"] = {"speed": {"tier1": tier1, "tier2": model.meta["tier2"], "model": model.meta["name"],
                                      "threshold": model.meta["threshold"], "threshold_from": model.meta["threshold_from"]}}
        print(f"erasure model: {tier1} -> {model.meta['tier2']}, {model.meta['name']}, threshold {model.meta['threshold']:.2e} (from the sweep)")
    (REPORTS / f"training{suffix}.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
