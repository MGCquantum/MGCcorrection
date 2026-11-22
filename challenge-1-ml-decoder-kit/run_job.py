"""Decode a batch of shots once with chosen decoders and cache everything the analysis needs.

  python run_job.py --basis X --p 0.004 --shots 2000 --seed 2 --decoders bp relay --out results/test_X_p0.004.npz
  python run_job.py --basis X --p 0.004 --f 0.5 --shots 2000 --seed 2 --decoders bposd bposd_flags --out results/erase_X_p0.004_f0.5.npz

Decoders
  bp           plain min-sum BP, 200 iterations (the fast stage); records convergence
  relay        relay-BP at the kit's settings (the strong stage)
  bposd        BP-OSD at the kit's settings
  bposd_flags  BP-OSD that uses the erasure flags (needs --f > 0)
  bp_flags     fast BP that uses the erasure flags (needs --f > 0)

Saved per shot: fail_<dec>, time_<dec> (seconds, decode call only), conv_<dec> (BP decoders),
round_weights (alarms per round, router features), n_flags.
"""
import argparse
import hashlib
import json
import platform
from importlib.metadata import version
import os
import time
from multiprocessing import Pool

import numpy as np
from ldpc import BpDecoder

from circuit import GROSS_CIRCUITS, detector_ids, load_circuit, sample
from decoders import bposd_decoder, relay_decoder
from hybrid import FAST_BP
from threadpoolctl import threadpool_limits
from lossy import aware_matrices, blind_matrices, herald_ids, lossy_circuit, shot_priors



def parse_args():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--basis", choices=["X", "Z"], required=True)
    a.add_argument("--p", type=float, required=True)
    a.add_argument("--f", type=float, default=0.0, help="fraction of depolarizing noise turned into heralded erasure")
    a.add_argument("--shots", type=int, default=2000)
    a.add_argument("--seed", type=int, required=True, help="train and test must use different seeds")
    a.add_argument("--decoders", nargs="+", required=True)
    a.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    a.add_argument("--out", required=True)
    args = a.parse_args()
    if args.shots < 1 or args.workers < 1 or not 0 < args.p < 1 or not 0 <= args.f <= 1:
        a.error("shots/workers must be positive; 0 < p < 1 and 0 <= f <= 1")
    return args


def build(circuit, basis, names):
    """Matrices and decoder objects, built once per worker."""
    need_aware = any(n.endswith("_flags") for n in names)
    Hb, Lb, pb = blind_matrices(circuit, basis)
    out = {"blind": (Hb, Lb, pb)}
    if need_aware:
        out["aware"] = aware_matrices(circuit, basis)
    dec = {}
    for n in names:
        if n == "bp":
            dec[n] = BpDecoder(Hb, error_channel=list(pb), **FAST_BP)
        elif n == "relay":
            dec[n] = relay_decoder(Hb, pb)
        elif n == "bposd":
            dec[n] = bposd_decoder(Hb, pb)
        elif n == "bp_flags":
            H, L, p, hc, nc = out["aware"]
            dec[n] = BpDecoder(H, error_channel=list(p), **FAST_BP)
        elif n == "bposd_flags":
            H, L, p, hc, nc = out["aware"]
            dec[n] = bposd_decoder(H, p)
        else:
            raise ValueError(f"unknown decoder {n}")
    return out, dec


def work(job):
    """Decode one chunk of shots with every requested decoder."""
    circuit_text, basis, names, syn, obs, fired_lists = job
    import stim
    threadpool_limits(limits=1)
    circuit = stim.Circuit(circuit_text)
    mats, dec = build(circuit, basis, names)
    n = len(syn)
    res = {}
    for name, d in dec.items():
        flags = name.endswith("_flags")
        H, L, p, hc, nc = mats["aware"] if flags else (*mats["blind"], None, None)
        fail, secs, conv = np.zeros(n, bool), np.zeros(n), np.zeros(n, bool)
        for k in range(n):
            t = time.perf_counter()     # the per-shot prior update counts as decode time
            if flags:
                d.update_channel_probs(shot_priors(p, hc, fired_lists[k], nc))
            e = np.asarray(d.decode(syn[k]), np.uint8)
            secs[k] = time.perf_counter() - t
            fail[k] = ((L @ e) % 2 != obs[k]).any()
            conv[k] = bool(getattr(d, "converge", True))
        res[name] = (fail, secs, conv)
    return res


def main():
    a = parse_args()
    base = load_circuit(GROSS_CIRCUITS[a.basis])
    circuit = lossy_circuit(base, a.p, a.f)
    det, obs = sample(circuit, a.shots, a.seed)
    ids, hid = detector_ids(circuit, a.basis), herald_ids(circuit)
    syn = det[:, ids]
    fired = [hid[det[k, hid] == 1] for k in range(a.shots)] if len(hid) else [np.array([], int)] * a.shots
    chunks = np.array_split(np.arange(a.shots), a.workers)
    jobs = [(str(circuit), a.basis, a.decoders, syn[c], obs[c], [fired[k] for k in c]) for c in chunks if len(c)]
    start = time.time()
    with Pool(len(jobs)) as pool:
        parts = pool.map(work, jobs)
    save = {"p": a.p, "f": a.f, "seed": a.seed, "basis": a.basis, "shots": a.shots,
            "round_weights": syn.reshape(a.shots, -1, 72).sum(axis=2),
            "n_flags": np.array([len(x) for x in fired]),
            "sample_sha256": hashlib.sha256(det.tobytes() + obs.tobytes()).hexdigest(),
            "provenance_json": json.dumps({"python": platform.python_version(),
                "platform": platform.platform(), "workers": a.workers, "threads_per_worker": 1,
                "versions": {n: version(n) for n in ["stim", "numpy", "ldpc", "relay-bp"]}})}
    for name in a.decoders:
        for i, key in enumerate(["fail", "time", "conv"]):
            save[f"{key}_{name}"] = np.concatenate([part[name][i] for part in parts])
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    np.savez_compressed(a.out, **save)
    summary = "  ".join(f"{n}: fails {save['fail_' + n].sum()} mean {save['time_' + n].mean() * 1e3:.0f} ms"
                        for n in a.decoders)
    print(f"{a.out}  [{time.time() - start:.0f} s]  {summary}")


if __name__ == "__main__":
    main()
