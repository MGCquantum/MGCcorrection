"""Per-shot plain-BP features/labels and (optionally) cached strong-decoder results.

  # training set: BP only (cheap)
  python compute.py --data train_X.npz --out feats_train_0.004.npz
  # test set: BP + strong decoders (slow, run once, cache)
  python compute.py --data test_X.npz --strong bposd relay-bp --out feats_test_0.004.npz

Shots are split into CONTIGUOUS chunks, so output order matches the input file order.
"""
import argparse
import os
import time
from multiprocessing import Pool

import numpy as np
from ldpc import BpDecoder

from circuit import GROSS_CIRCUITS, dem_matrices, load_circuit
from decoders import bposd_decoder, relay_decoder, score

BP_SETTINGS = {"max_iter": 80, "bp_method": "minimum_sum", "ms_scaling_factor": 1.0}
STRONG = {"bposd": bposd_decoder, "relay-bp": relay_decoder}
G = {}


def init(H, L, priors, strong):
    G.update(H=H, L=L, priors=priors, strong=strong)
    G["bp"] = BpDecoder(H, error_channel=list(priors), **BP_SETTINGS)
    G["dec"] = {}
    for name in strong:
        try:
            G["dec"][name] = STRONG[name](H, priors)
        except ImportError:
            print(f"{name} not installed, skipped")


def features(syndrome, error, bp):
    llr = np.abs(np.asarray(bp.log_prob_ratios, float))
    return [syndrome.sum(), float(bp.converge), float(bp.iter), llr.min(), llr.mean(),
            (llr < 2).sum(), error.sum()]


def work(chunk):
    det, obs = chunk
    L, bp = G["L"], G["bp"]
    n = len(det)
    feats, failed, secs = np.zeros((n, 7)), np.zeros(n, bool), np.zeros(n)
    for k in range(n):
        t = time.perf_counter()
        e = np.asarray(bp.decode(det[k]), np.uint8)
        secs[k] = time.perf_counter() - t
        failed[k] = ((L @ e) % 2 != obs[k]).any()
        feats[k] = features(det[k], e, bp)
    out = {"X": feats, "bp_failed": failed, "bp_sec": secs}
    for name, dec in G["dec"].items():
        f, s = score(dec.decode, L, det, obs)
        out[f"{name}_failed"], out[f"{name}_sec"] = f, s
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--strong", nargs="*", default=[], choices=list(STRONG))
    ap.add_argument("--workers", type=int, default=max(1, os.cpu_count() // 2))
    ap.add_argument("--max-shots", type=int, default=None)
    args = ap.parse_args()

    d = np.load(args.data)
    basis, p = str(d["basis"]), float(d["p"])
    det = d["detectors"][:, d["basis_detectors"]]
    obs = d["observables"]
    if args.max_shots:
        det, obs = det[: args.max_shots], obs[: args.max_shots]
    circuit = load_circuit(GROSS_CIRCUITS[basis], p)
    H, L, priors = dem_matrices(circuit, basis)
    print(f"{len(det)} shots, basis {basis}, p={p}")

    idx = np.array_split(np.arange(len(det)), args.workers * 4)
    chunks = [(det[i], obs[i]) for i in idx if len(i)]
    with Pool(args.workers, initializer=init, initargs=(H, L, priors, args.strong)) as pool:
        results = pool.map(work, chunks)   # map preserves chunk order
    merged = {k: np.concatenate([r[k] for r in results]) for k in results[0]}
    np.savez_compressed(args.out, p=p, **merged)
    print("BP failure rate:", merged["bp_failed"].mean(),
          "| BP converged:", merged["X"][:, 1].mean(), "->", args.out)
    for name in args.strong:
        if f"{name}_failed" in merged:
            print(name, "failure rate:", merged[f"{name}_failed"].mean(),
                  "mean s:", merged[f"{name}_sec"].mean())


if __name__ == "__main__":
    main()