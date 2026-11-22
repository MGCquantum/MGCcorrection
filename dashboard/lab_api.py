"""Read-only payloads for the research-lab frontend (lab/), served by dashboard/server.py.

Everything here is computed from the starter kit's code or read from experiments/; nothing is
typed in by hand. Two kinds of payload:

  gross_structure()   the [[144,12,12]] code itself: check matrices, ranks, logical operators,
                      CX schedule and the shape of the detector error model (computed live, cached)
  records_summary()   per-shot records in experiments/records/: failures with Wilson intervals,
                      logical error rate per cycle and decode-time distributions (stored)
"""
import json
import re
import threading
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RECORDS = ROOT / "experiments" / "records"
MANIFEST = ROOT / "experiments" / "manifest.json"
CALIBRATION = ROOT / "experiments" / "reports" / "calibration.json"
TRAINING = ROOT / "experiments" / "reports" / "training.json"
RECORD_NAME = re.compile(r"^(?P<split>[a-z]+)_(?P<basis>[XZ])_p(?P<p>[0-9.]+?)(?:_f(?P<f>[0-9.]+))?\.npz$")
# Pair decode time histogram: log-spaced bins from 0.5 ms to 100 s.
LATENCY_EDGES_MS = np.logspace(np.log10(0.5), 5, 43)

_lock = threading.Lock()
_structure = None
_summary_cache = {}


# ---------------------------------------------------------------- the code
def gross_structure():
    """The Gross code from make_circuit.py and its 12-cycle memory circuits. Computed once."""
    global _structure
    with _lock:
        if _structure is None:
            _structure = _build_structure()
        return _structure


def _build_structure():
    import make_circuit as mc
    from circuit import GROSS_CIRCUITS, dem_matrices, detector_ids, load_circuit

    start = time.perf_counter()
    ell, m, a, b, rounds = mc.CODES["gross"]
    layout = mc.code_layout("gross")
    n2 = layout.n2
    hx, hz = layout.hx.astype(np.uint8), layout.hz.astype(np.uint8)
    rank_x, rank_z = mc.gf2_rank(hx), mc.gf2_rank(hz)
    logical_x = mc.logical_operators(hx, hz)          # X-type logicals: commute with Z checks
    logical_z = mc.logical_operators(hz, hx)
    # Neighbour d of a check, as a data-qubit index 0..143 (left block 0..71, right block 72..143).
    x_checks = [[int(layout.x_neighbours[d][i]) - n2 for d in range(6)] for i in range(n2)]
    z_checks = [[int(layout.z_neighbours[d][i]) - n2 for d in range(6)] for i in range(n2)]

    circuits = {}
    for basis in "XZ":
        circuit = load_circuit(GROSS_CIRCUITS[basis], 0.004)
        H, L, priors = dem_matrices(circuit, basis)
        H = H.tocsc()
        column_weight = np.asarray(H.sum(axis=0)).ravel().astype(int)
        flips_logical = np.asarray(L.sum(axis=0)).ravel() > 0
        rows, cols = H.shape
        # Block counts of the nonzeros of H: shows which syndrome rounds each column touches.
        coo = H.tocoo()
        row_bins, col_bins = 52, 96
        grid = np.zeros((row_bins, col_bins), int)
        np.add.at(grid, (coo.row * row_bins // rows, coo.col * col_bins // cols), 1)
        circuits[basis] = {
            "file": Path(GROSS_CIRCUITS[basis]).name,
            "qubits": circuit.num_qubits, "measurements": circuit.num_measurements,
            "detectors_total": circuit.num_detectors, "detectors_decoded": int(len(detector_ids(circuit, basis))),
            "observables": circuit.num_observables, "noise_p_used_for_dem": 0.004,
            "H_shape": [int(rows), int(cols)], "H_nonzeros": int(H.nnz),
            "column_weight_histogram": {str(w): int(c) for w, c in zip(*np.unique(column_weight, return_counts=True))},
            "columns_flipping_a_logical": int(flips_logical.sum()),
            "prior_range": [float(priors.min()), float(priors.max())],
            "H_block_counts": grid.tolist(), "H_block_shape": [row_bins, col_bins],
        }

    return {
        "source": "live", "computed_by": "challenge-1-ml-decoder-kit/make_circuit.py and circuit.py",
        "name": "gross", "ell": ell, "m": m, "rounds": rounds,
        "A": {"terms": ["x^%d" % a[0], "y^%d" % a[1], "y^%d" % a[2]], "exponents": list(a)},
        "B": {"terms": ["y^%d" % b[0], "x^%d" % b[1], "x^%d" % b[2]], "exponents": list(b)},
        "n": int(hx.shape[1]), "k": int(hx.shape[1] - rank_x - rank_z),
        "rank_hx": int(rank_x), "rank_hz": int(rank_z),
        "checks_per_type": int(n2),
        "row_weights": {"hx": sorted({int(w) for w in hx.sum(axis=1)}), "hz": sorted({int(w) for w in hz.sum(axis=1)})},
        "column_weights": {"hx": sorted({int(w) for w in hx.sum(axis=0)}), "hz": sorted({int(w) for w in hz.sum(axis=0)})},
        "commute": bool(not ((hx.astype(int) @ hz.T.astype(int)) % 2).any()),
        "distance": {"value": 12, "computed_here": False,
                     "source": "Bravyi et al., Nature 627, 778 (2024); not recomputed (an NP-hard search)"},
        "x_checks": x_checks, "z_checks": z_checks,
        "neighbour_labels": ["A1", "A2", "A3", "B1", "B2", "B3"],
        "schedule": {"x": [s if s != mc.IDLE else None for s in mc.S_X],
                     "z": [s if s != mc.IDLE else None for s in mc.S_Z]},
        "logical_x": [np.flatnonzero(row).tolist() for row in logical_x],
        "logical_z": [np.flatnonzero(row).tolist() for row in logical_z],
        "circuits": circuits, "seconds": round(time.perf_counter() - start, 3),
    }


# ---------------------------------------------------------------- stored records
def _record_files():
    """{(split, p, f): {basis: path}} for every record file name that parses."""
    found = {}
    for path in sorted(RECORDS.glob("*.npz")):
        match = RECORD_NAME.match(path.name)
        if match:
            key = (match["split"], float(match["p"]), float(match["f"] or 0.0))
            found.setdefault(key, {})[match["basis"]] = path
    return found


def _tiers(data):
    return sorted({k.split("/")[0] for k in data.files if k.endswith("/failed")})


def _latency(ms):
    counts, _ = np.histogram(np.clip(ms, LATENCY_EDGES_MS[0], LATENCY_EDGES_MS[-1]), LATENCY_EDGES_MS)
    return counts.tolist()


def _summarize_setting(paths):
    from aegis.policy import summarize

    x, z = np.load(paths["X"]), np.load(paths["Z"])
    shots = min(int(x["shots"]), int(z["shots"]))
    tiers = [t for t in _tiers(x) if t in _tiers(z)]
    out = {}
    for tier in tiers:
        fx, fz = x[f"{tier}/failed"][:shots], z[f"{tier}/failed"][:shots]
        sx, sz = x[f"{tier}/seconds"][:shots], z[f"{tier}/seconds"][:shots]
        row = summarize(fx, fz, sx, sz)
        row["latency_counts"] = _latency((sx + sz) * 1e3)
        row["unconverged"] = float(1 - (x[f"{tier}/converged"][:shots].mean() + z[f"{tier}/converged"][:shots].mean()) / 2)
        out[tier] = row
    return {"pairs": shots, "seed": int(x["seed"]), "tiers": out,
            "files": [paths["X"].name, paths["Z"].name],
            "written": time.strftime("%Y-%m-%d %H:%M", time.localtime(max(p.stat().st_mtime for p in paths.values())))}


def records_summary():
    """Every complete (X and Z) record setting, summarized in the kit's pair convention."""
    settings, pending = [], []
    for (split, p, f), paths in sorted(_record_files().items()):
        if set(paths) != {"X", "Z"}:
            pending.append({"split": split, "p": p, "f": f, "have": sorted(paths)})
            continue
        stamp = tuple(path.stat().st_mtime for path in paths.values())
        key = (split, p, f)
        with _lock:
            cached = _summary_cache.get(key)
        if cached is None or cached[0] != stamp:
            try:
                cached = (stamp, _summarize_setting(paths))
            except Exception as error:           # a record being rewritten right now
                pending.append({"split": split, "p": p, "f": f, "error": type(error).__name__})
                continue
            with _lock:
                _summary_cache[key] = cached
        settings.append({"split": split, "p": p, "f": f, **cached[1]})
    return {
        "source": "stored", "origin": "experiments/records/*.npz (per-shot records written by aegis.collect)",
        "convention": "Shot k of X memory is paired with shot k of Z memory. A pair fails when either fails; "
                      "LER per cycle = 1 - (1 - P)^(1/12); a pair's time is the X time plus the Z time.",
        "interval": "95% Wilson interval on the pair failure fraction, mapped to per-cycle; "
                    "mean-time interval from 1000 bootstrap resamples (aegis.policy.summarize)",
        "latency_edges_ms": LATENCY_EDGES_MS.tolist(),
        "settings": settings, "incomplete": pending,
    }


def manifest():
    """Run log: settings, wall and CPU time, peak memory and environment of every decoding run."""
    runs = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else []
    return {"source": "stored", "origin": "experiments/manifest.json", "runs": runs}


def calibration():
    """Reliability of the risk model's probabilities on validation shots."""
    if not CALIBRATION.exists():
        return {"source": "stored", "available": False}
    return {"source": "stored", "available": True, "origin": "experiments/reports/calibration.json",
            **json.loads(CALIBRATION.read_text())}


def training():
    """The operating points aegis.train chose, with their validation performance (not the full search)."""
    if not TRAINING.exists():
        return {"source": "stored", "available": False}
    report = json.loads(TRAINING.read_text())
    return {"source": "stored", "available": True, "origin": "experiments/reports/training.json",
            "written": time.strftime("%Y-%m-%d %H:%M", time.localtime(TRAINING.stat().st_mtime)),
            "caveat": "Thresholds were chosen on these validation shots, so these numbers are optimistic. "
                      "Only the frozen test split (seed 2) gives unbiased estimates.",
            "settings": report.get("settings"), "chosen": report.get("chosen"),
            "ranking": {k: {m: v[m] for m in ("shots", "wrong", "auc", "average_precision", "brier", "ece", "inference_us") if m in v}
                        for k, v in report.get("ranking", {}).items()}}


# ---------------------------------------------------------------- frozen-test evaluation: plan, progress, result
CHECKPOINTS = ROOT / "data" / "checkpoints"
EVALUATION = ROOT / "experiments" / "reports" / "evaluation.json"
PIPELINE_STATUS = ROOT / "experiments" / "pipeline_status.json"
FIGURES = ROOT / "docs" / "figures"
MODELS = ROOT / "models"
SWEEP_TIERS = ["bposd", "relay", "fast", "relay1", "strong10", "bp200"]          # scripts/run_experiments.sh
LOSS_TIERS = ["bposd", "relay", "bposd+flags", "relay+flags", "fast+flags", "relay1+flags", "strong10+flags"]
# (id, label, split, p, f, shots, chunk, tiers): the frozen-test plan of scripts/run_experiments.sh (test)
# and scripts/run_final.sh (online, timing). Each entry is one record file per basis.
M, ML = "models/aegis_router.joblib", "models/aegis_router_loss.joblib"   # the --model arguments of run_final.sh
PLAN = (
    [("test", "sweep", 0.004, 0.0, 10000, 50, SWEEP_TIERS, None), ("test", "sweep", 0.003, 0.0, 30000, 100, SWEEP_TIERS, None),
     ("test", "sweep", 0.005, 0.0, 5000, 25, SWEEP_TIERS, None)]
    + [("test", "erasure", 0.004, f, 5000, 50, LOSS_TIERS, None) for f in (0.5, 0.25, 0.75)]
    + [("test", "online", p, 0.0, n, c, ["aegis"], M) for p, n, c in ((0.004, 10000, 50), (0.003, 30000, 100), (0.005, 5000, 25))]
    + [("test", "online", 0.004, f, 5000, 50, ["aegis+flags"], ML) for f in (0.25, 0.5, 0.75)]
    + [("timing", "timing", p, 0.0, n, c, ["bposd", "relay", "aegis"], M) for p, n, c in ((0.003, 2000, 100), (0.004, 1000, 100), (0.005, 500, 50))]
)


def _record_name(split, basis, p, f):
    return f"{split}_{basis}_p{p}" + (f"_f{f}" if f else "")


def _collect_processes():
    """Local aegis pipeline processes (pid, command), read with ps. No network."""
    import subprocess
    out = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True).stdout
    keep = ("aegis.collect", "aegis.train", "aegis.evaluate", "aegis.figures", "run_frozen_evaluation", "run_experiments.sh", "run_final.sh")
    return [{"pid": int(line.split(None, 1)[0]), "command": line.split(None, 1)[1][:160]}
            for line in out.splitlines() if line.strip() and any(k in line for k in keep) and "ps -axo" not in line]


def _artifact(split, kind, p, f, shots, chunk, tiers, model):
    import hashlib
    total = -(-shots // chunk)
    # aegis.collect names its checkpoint folder <record>_<sha1(pending tiers, model, threshold)[:10]>.
    tag = hashlib.sha1(json.dumps([sorted(tiers), str(model), None]).encode()).hexdigest()[:10]
    bases = {}
    for basis in "XZ":
        name = _record_name(split, basis, p, f)
        path = RECORDS / f"{name}.npz"
        have = set()
        if path.exists():
            try:
                have = {k.split("/")[0] for k in np.load(path).files if k.endswith("/failed")}
            except Exception:
                have = set()
        if all(t in have for t in tiers):
            bases[basis] = {"state": "done", "chunks": total, "of": total}
            continue
        folder = CHECKPOINTS / f"{name}_{tag}"
        done = len(list(folder.glob("*.npz"))) if folder.exists() else 0
        bases[basis] = {"state": "partial" if done else "pending", "chunks": done, "of": total}
    states = {b["state"] for b in bases.values()}
    state = "done" if states == {"done"} else "partial" if states & {"done", "partial"} else "pending"
    label = {"sweep": f"test records, p = {p}", "erasure": f"test records, erasure f = {f}",
             "online": f"QEC-Aegis online, p = {p}" + (f", f = {f}" if f else ""), "timing": f"single-worker timing, p = {p}"}[kind]
    return {"kind": kind, "label": label, "split": split, "p": p, "f": f, "shots": shots, "tiers": tiers, "state": state, "bases": bases}


def pipeline():
    """Progress of the frozen-test evaluation: every planned artifact, the runner's status file, live processes."""
    artifacts = [_artifact(*row) for row in PLAN]
    runner = json.loads(PIPELINE_STATUS.read_text()) if PIPELINE_STATUS.exists() else None
    processes = _collect_processes()
    return {"source": "live", "computed_by": "dashboard/lab_api.py (reads experiments/, data/checkpoints/, ps)",
            "artifacts": artifacts, "loss_model": (MODELS / "aegis_router_loss.joblib").exists(),
            "evaluation_written": time.strftime("%Y-%m-%d %H:%M", time.localtime(EVALUATION.stat().st_mtime)) if EVALUATION.exists() else None,
            "figures": sorted(f.name for f in FIGURES.glob("*.png")) if FIGURES.exists() else [],
            "runner": runner, "processes": processes,
            "start_command": "./scripts/run_frozen_evaluation.sh"}


def evaluation():
    """aegis.evaluate's report on the frozen test shots, with an honest state.

    completed  every planned setting (sweep, online, erasure, timing) is in the report, and no test or
               timing record is newer than the report
    partial    a report exists but lacks settings or is older than the records: not final
    running    a pipeline step is running now
    failed     the runner recorded a failed step
    pending    nothing has produced a report yet
    """
    status = pipeline()
    runner = status["runner"] or {}
    report = json.loads(EVALUATION.read_text()) if EVALUATION.exists() else None
    gaps = []
    if report:
        for p in ("0.003", "0.004", "0.005"):
            if p not in report.get("sweep", {}):
                gaps.append(f"sweep p = {p} missing")
            elif "aegis (online)" not in report["sweep"][p].get("decoders", {}):
                gaps.append(f"online QEC-Aegis run missing at p = {p}")
            if p not in report.get("timing", {}):
                gaps.append(f"single-worker timing missing at p = {p}")
        for f in ("0.25", "0.5", "0.75"):
            if f not in report.get("loss", {}):
                gaps.append(f"erasure f = {f} missing")
        newest = max((path.stat().st_mtime for path in RECORDS.glob("*.npz") if path.name.startswith(("test_", "timing_"))), default=0)
        if newest > EVALUATION.stat().st_mtime:
            gaps.append("records changed after the report was written (stale)")
        report.pop("runs", None)
    running = runner.get("state") == "running" or bool(status["processes"])
    state = ("running" if running else "failed" if runner.get("state") == "failed"
             else "completed" if report and not gaps else "partial" if report else "pending")
    return {"source": "stored", "origin": "experiments/reports/evaluation.json (aegis.evaluate)", "state": state,
            "final": state == "completed", "gaps": gaps, "pipeline": status,
            "written": status["evaluation_written"], "report": report}


def methods():
    """Methodology as written in the code that produced each study (module docstrings)."""
    import importlib
    out = {}
    for name in ("aegis.study", "aegis.predecoder", "aegis.policy", "aegis.features", "aegis.model", "aegis.decoder", "aegis.evaluate", "aegis.tiers"):
        try:
            out[name] = (importlib.import_module(name).__doc__ or "").strip()
        except Exception as error:
            out[name] = f"(not importable: {type(error).__name__})"
    from aegis import features
    return {"source": "stored", "origin": "module docstrings", "docs": out, "feature_groups": features.GROUPS}
