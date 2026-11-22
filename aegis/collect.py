"""Decode a fixed set of shots with chosen tiers and cache every per-shot record.

  python -m aegis.collect --split test --basis X --p 0.004 --shots 10000 --tiers bposd relay fast strong

The shots are fixed by (basis, p, f, seed, shots). The seed comes from the split: train 1, test 2,
validation 3, calibration 4 (override with --seed for extra training data). Records go to
experiments/records/<split>_<basis>_p<p>[_f<f>].npz for test and validation and to data/records/
for training data. A second call with more tiers adds them to the same file and decodes nothing
twice. Work is checkpointed in chunks, so an interrupted run resumes where it stopped.

Reproducibility: relay-BP is a randomized decoder whose random stream runs on from shot to shot.
Every decoder is reset at the start of a chunk, so a record is a function of (basis, p, f, seed,
shots, chunk size) and does not depend on the number of workers or on scheduling. Decoding the
same shots with another chunk size gives statistically equivalent, not identical, answers on
the shots that need relay legs.

Per tier and shot: failed, seconds (the decode call, including prior updates for herald flags),
converged, iterations, weight, predicted observables and, for relay-BP tiers, the feature vector.
`--tiers aegis` runs the complete routed decoder online (needs --model).
"""
import argparse
import hashlib
import json
import os
import platform
import resource
import subprocess
import time
from importlib import metadata
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from mgccorrection.paths import DATA, ROOT

from . import CALIB_SEED, TEST_SEED, TRAIN_SEED, VAL_SEED, features
from .problem import Problem

SEEDS = {"train": TRAIN_SEED, "test": TEST_SEED, "val": VAL_SEED, "calib": CALIB_SEED, "timing": 5}
RECORDS = ROOT / "experiments" / "records"       # committed: test and validation records
TRAIN_RECORDS = DATA / "records"                 # not committed: regenerate with `make data`
MANIFEST = ROOT / "experiments" / "manifest.json"
FIELDS = {"failed": bool, "seconds": float, "converged": bool, "iterations": np.int64, "weight": float}
_worker = {}


def record_path(split, basis, p, f=0.0, seed=None):
    name = f"{split}_{basis}_p{p}" + (f"_f{f}" if f else "")
    if seed is not None and seed != SEEDS.get(split):
        name += f"_s{seed}"
    return (TRAIN_RECORDS if split in ("train", "calib") else RECORDS) / f"{name}.npz"


def _init(problem_args, tiers, model_path, threshold):
    from .decoder import AegisDecoder, load_model
    from .tiers import build
    problem = Problem(**problem_args)
    _worker["problem"] = problem
    _worker["decoders"] = {}
    for name in tiers:
        if name.startswith("aegis"):
            flags = "+flags" if name.endswith("+flags") else ""
            _worker["decoders"][name] = AegisDecoder(problem, load_model(model_path), threshold, use_flags=bool(flags))
        else:
            _worker["decoders"][name] = build(name, problem)


def _decode_chunk(job):
    index, syndromes, other, obs, fired = job
    problem, out = _worker["problem"], {}
    for name, decoder in _worker["decoders"].items():
        decoder.reset()   # a chunk's result then depends on its shots only, not on what the worker decoded before
        n = len(syndromes)
        rec = {key: np.zeros(n, kind) for key, kind in FIELDS.items()}
        rec["predicted"] = np.zeros((n, obs.shape[1]), np.uint8)
        rec["features"] = np.zeros((n, len(features.NAMES)), np.float32)
        extra = {"risk": np.full(n, np.nan), "escalated": np.zeros(n, bool), "seconds_tier1": np.zeros(n),
                 "seconds_model": np.zeros(n)} if name.startswith("aegis") else {}
        for k in range(n):
            start = time.perf_counter()
            result = decoder.decode_shot(syndromes[k], int(other[k]), fired[k])
            rec["seconds"][k] = time.perf_counter() - start
            rec["predicted"][k] = (problem.L @ result.error) % 2
            rec["failed"][k] = (rec["predicted"][k] != obs[k]).any()
            rec["converged"][k], rec["iterations"][k], rec["weight"][k] = result.converged, result.iterations, result.weight
            if result.features is not None:
                rec["features"][k] = result.features
            for key in extra:
                extra[key][k] = getattr(result, key)
        if not getattr(decoder, "has_features", True):
            del rec["features"]
        out[name] = rec | extra
    return index, out


def collect(split, basis, p, f, shots, tiers, seed=None, workers=8, chunk=50, model_path=None, threshold=None,
            force=False, log=print):
    """Decode and cache. Returns the path of the record file."""
    seed = SEEDS[split] if seed is None else seed
    if split == "test" and seed != TEST_SEED:
        raise ValueError("the test split is frozen at seed 2")
    path = record_path(split, basis, p, f, seed)
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = dict(np.load(path)) if path.exists() else {}
    if existing and int(existing["shots"]) != shots:
        raise ValueError(f"{path} holds {int(existing['shots'])} shots, not {shots}. Use the same --shots or another split.")
    pending = [t for t in tiers if force or f"{t}/failed" not in existing]
    if not pending:
        log(f"{path.name}: all of {tiers} cached")
        return path

    problem_args = {"basis": basis, "p": p, "f": f}
    problem = Problem(**problem_args)
    syndromes, other, obs, fired = problem.sample(shots, seed)
    other_weight = other.sum(axis=1)
    tag = hashlib.sha1(json.dumps([sorted(pending), str(model_path), threshold]).encode()).hexdigest()[:10]
    checkpoints = DATA / "checkpoints" / f"{path.stem}_{tag}"
    checkpoints.mkdir(parents=True, exist_ok=True)
    bounds = [(a, min(a + chunk, shots)) for a in range(0, shots, chunk)]
    todo = [k for k in range(len(bounds)) if not (checkpoints / f"{k:05d}.npz").exists()]
    jobs = ((k, syndromes[a:b], other_weight[a:b], obs[a:b], fired[a:b]) for k, (a, b) in ((k, bounds[k]) for k in todo))
    start, done = time.time(), 0
    cpu_before = resource.getrusage(resource.RUSAGE_CHILDREN)
    with Pool(workers, initializer=_init, initargs=(problem_args, pending, model_path, threshold)) as pool:
        for index, out in pool.imap_unordered(_decode_chunk, jobs):
            np.savez(checkpoints / f"{index:05d}.npz", **{f"{t}/{key}": v for t, rec in out.items() for key, v in rec.items()})
            done += 1
            if done % max(1, len(todo) // 10) == 0:
                log(f"{path.name}: {done}/{len(todo)} chunks, {time.time() - start:.0f} s")
    cpu_after = resource.getrusage(resource.RUSAGE_CHILDREN)

    parts = [dict(np.load(checkpoints / f"{k:05d}.npz")) for k in range(len(bounds))]
    merged = {key: np.concatenate([part[key] for part in parts]) for key in parts[0]}
    record = existing | merged | {
        "observables": obs, "herald_count": np.array([len(x) for x in fired]), "other_weight": other_weight,
        "syndrome_weight": syndromes.sum(axis=1), "basis": basis, "p": p, "f": f, "seed": seed, "shots": shots,
        "feature_names": np.array(features.NAMES)}
    np.savez_compressed(path, **record)
    for file in checkpoints.iterdir():
        file.unlink()
    checkpoints.rmdir()

    wall = time.time() - start
    cpu = (cpu_after.ru_utime + cpu_after.ru_stime) - (cpu_before.ru_utime + cpu_before.ru_stime)
    entry = {"record": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path), "split": split, "basis": basis, "p": p, "f": f, "seed": seed,
             "shots": shots, "tiers": pending, "workers": workers, "chunk": chunk, "wall_seconds": round(wall, 1),
             "cpu_seconds": round(cpu, 1), "peak_worker_rss_mb": round(cpu_after.ru_maxrss / 2**20, 1),
             "resumed_chunks": len(bounds) - len(todo), "finished": time.strftime("%Y-%m-%d %H:%M:%S"),
             "model": str(model_path) if model_path else None, "threshold": threshold, "environment": environment()}
    append_manifest(entry)
    summary = "  ".join(f"{t}: {int(merged[f'{t}/failed'].sum())} failed, {merged[f'{t}/seconds'].mean() * 1e3:.1f} ms" for t in pending)
    log(f"{path.name} [{wall:.0f} s wall, {cpu:.0f} s cpu, {workers} workers]  {summary}")
    return path


def environment():
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    return {"python": platform.python_version(), "machine": f"{platform.system()} {platform.machine()}",
            "cores": os.cpu_count(), "commit": commit,
            **{pkg: metadata.version(pkg) for pkg in ("stim", "ldpc", "relay-bp", "numpy", "scikit-learn")}}


def append_manifest(entry):
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    runs = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else []
    runs.append(entry)
    MANIFEST.write_text(json.dumps(runs, indent=1))


def load(path):
    """Record file as {'tier': {field: array}, 'observables': ..., ...}."""
    out = {}
    with np.load(path) as data:
        for key in data.files:
            if "/" in key:
                tier, name = key.split("/")
                out.setdefault(tier, {})[name] = data[key]
            else:
                out[key] = data[key] if data[key].ndim else data[key].item()
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--split", choices=list(SEEDS), required=True)
    parser.add_argument("--basis", choices=["X", "Z"], nargs="+", default=["X", "Z"])
    parser.add_argument("--p", type=float, nargs="+", required=True)
    parser.add_argument("--f", type=float, default=0.0, help="fraction of depolarizing noise turned into heralded erasure")
    parser.add_argument("--shots", type=int, required=True)
    parser.add_argument("--tiers", nargs="+", required=True)
    parser.add_argument("--seed", type=int, help="only for extra training data; test is frozen at 2")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--chunk", type=int, default=50)
    parser.add_argument("--model")
    parser.add_argument("--threshold", type=float)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    for p in args.p:
        for basis in args.basis:
            collect(args.split, basis, p, args.f, args.shots, args.tiers, args.seed, args.workers, args.chunk,
                    args.model, args.threshold, args.force)


if __name__ == "__main__":
    main()
