"""Check that committed records are reproducible from (basis, p, f, seed, shots, chunk) and the code.

  python -m aegis.reproduce                       every record: resample, compare stored sample data
  python -m aegis.reproduce --decode 2            also re-decode 2 chunks per record and tier, bit for bit
  python -m aegis.reproduce --decode 1 --only test_X_p0.004

Sampling check (seconds per record): the shots are drawn again from the record's seed and must give
exactly the stored observables, syndrome weights, other-basis weights and herald counts.

Decoding check: chunks are chosen deterministically (first, last, then evenly spaced). Each chunk is
decoded by fresh tier objects, exactly as aegis.collect does, with the chunk size the manifest
records for that tier. Every stored per-shot field (prediction, failure, convergence, iterations,
weight and the feature vector) must match exactly; times are measurements and are not compared.
The online routed decoder (tier `aegis`) is re-run with the model and threshold the manifest records.

Records are only reproducible on the same package versions (stim, ldpc, relay-bp, numpy,
scikit-learn): Stim seeds are not portable across builds. The check reports the versions it used.
Exit status is nonzero when any check fails.
"""
import argparse
import json
import sys
from importlib import metadata

import numpy as np

from .collect import MANIFEST, RECORDS, SEEDS, _decode_chunk, _init, _worker, load
from .paths import ROOT
from .problem import Problem

COMPARED = ("predicted", "failed", "converged", "iterations", "weight", "features", "escalated", "risk")


def chunk_sizes(manifest):
    """{(record path, tier): (chunk, model, threshold)} from the latest manifest entry that decoded it."""
    out = {}
    for entry in manifest:
        for tier in entry["tiers"]:
            out[(entry["record"], tier)] = (entry.get("chunk"), entry.get("model"), entry.get("threshold"))
    return out


def pick(n_chunks, k):
    """k chunk indices: first, last, then evenly spaced."""
    if k >= n_chunks:
        return list(range(n_chunks))
    return sorted({int(round(x)) for x in np.linspace(0, n_chunks - 1, k)})


def check_record(path, sizes, decode, log=print):
    """List of failure messages for one record file (empty when it reproduces)."""
    record = load(path)
    split = path.stem.split("_")[0]
    basis, p, f, seed, shots = record["basis"], float(record["p"]), float(record["f"]), int(record["seed"]), int(record["shots"])
    if seed != SEEDS.get(split, seed):
        return [f"{path.name}: seed {seed} is not the {split} seed {SEEDS[split]}"]
    problem = Problem(basis, p, f)
    syndromes, other, obs, fired = problem.sample(shots, seed)
    problems = []
    stored = {"observables": obs, "syndrome_weight": syndromes.sum(axis=1), "other_weight": other.sum(axis=1),
              "herald_count": np.array([len(x) for x in fired])}
    for key, value in stored.items():
        if key in record and not np.array_equal(np.asarray(record[key]), value):
            problems.append(f"{path.name}: resampled {key} differs from the stored one")
    if problems or not decode:
        return problems
    rel = str(path.relative_to(ROOT))
    tiers = [t for t in record if isinstance(record[t], dict)]
    for tier in tiers:
        chunk, model, threshold = sizes.get((rel, tier), (None, None, None))
        if not chunk:
            problems.append(f"{path.name} {tier}: the manifest records no chunk size, so it cannot be re-decoded")
            continue
        if tier.startswith("aegis") and not model:
            problems.append(f"{path.name} {tier}: the manifest records no model")
            continue
        _init({"basis": basis, "p": p, "f": f}, [tier], str(ROOT / model) if model and not model.startswith("/") else model,
              threshold)
        bounds = [(a, min(a + chunk, shots)) for a in range(0, shots, chunk)]
        for index in pick(len(bounds), decode):
            a, b = bounds[index]
            _, out = _decode_chunk((index, syndromes[a:b], other[a:b].sum(axis=1), obs[a:b], fired[a:b]))
            for key in COMPARED:
                if key in record[tier] and key in out[tier]:
                    want, got = record[tier][key][a:b], out[tier][key]
                    same = np.array_equal(want, got, equal_nan=True) if np.issubdtype(np.asarray(want).dtype, np.floating) \
                        else np.array_equal(want, got)
                    if not same:
                        problems.append(f"{path.name} {tier} chunk {index} (shots {a}-{b}): {key} differs")
        log(f"  {path.name} {tier}: re-decoded {min(decode, len(bounds))} of {len(bounds)} chunks of {chunk}")
    _worker.clear()
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--decode", type=int, default=0, help="chunks to re-decode per record and tier (0: sampling only)")
    parser.add_argument("--only", nargs="*", help="record stems to check, e.g. test_X_p0.004")
    args = parser.parse_args(argv)
    versions = {pkg: metadata.version(pkg) for pkg in ("stim", "ldpc", "relay-bp", "numpy", "scikit-learn")}
    print(f"package versions: {versions}")
    sizes = chunk_sizes(json.loads(MANIFEST.read_text()))
    paths = sorted(RECORDS.glob("*.npz"))
    if args.only:
        paths = [p for p in paths if p.stem in args.only]
    failures = []
    for path in paths:
        found = check_record(path, sizes, args.decode)
        print(f"{path.name}: {'OK' if not found else 'FAILED'}")
        failures += found
    for line in failures:
        print("  " + line)
    print(f"{len(paths) - len({f.split(':')[0].split()[0] for f in failures})} of {len(paths)} records reproduce")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
