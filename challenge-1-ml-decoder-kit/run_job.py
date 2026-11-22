"""Decode a batch of shots once with chosen decoders and cache everything the analysis needs.

  python run_job.py --basis X --p 0.004 --shots 2000 --seed 2 --decoders bp relay --out results/test_X_p0.004.npz
  python run_job.py --basis X --p 0.004 --f 0.5 --shots 2000 --seed 2 --decoders bposd bposd_flags --out results/erase_X_p0.004_f0.5.npz

Decoders
  bp           plain min-sum BP, 200 iterations (the fast stage); records convergence
  relay        relay-BP at the kit's settings (the strong stage)
  bposd        BP-OSD at the kit's settings
  bposd_flags  BP-OSD that uses the erasure flags (needs --f > 0)
  bp_flags     fast BP that uses the erasure flags (needs --f > 0)
  relay_flags  relay-BP on the blind matrix, rebuilt each shot with the flags folded into its priors (needs --f > 0)

Saved per shot: fail_<dec>, time_<dec> (seconds, decode call only), conv_<dec> (BP decoders),
round_weights (alarms per round, router features), n_flags.

Reproducibility: relay-BP draws the memory strengths of its relay legs from a random stream that
runs on from shot to shot, so its answer on a hard shot depends on the shots it decoded before.
Shots are therefore split into fixed chunks of --chunk shots (not one chunk per worker) and
relay-BP is rebuilt at the start of every chunk. A record is then a function of (basis, p, f,
seed, shots, chunk) and the installed package versions, and does not depend on --workers or on
scheduling. Caches written before this change used one chunk per worker; they remain valid
samples but are not bit-for-bit regenerable with another worker count.
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
from lossy import aware_matrices, blind_column_map, blind_matrices, fold_priors, herald_ids, herald_qubits, lossy_circuit, shot_priors, timing_window_flags



def parse_args():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--basis", choices=["X", "Z"], required=True)
    a.add_argument("--p", type=float, required=True)
    a.add_argument("--f", type=float, default=0.0, help="fraction of depolarizing noise turned into heralded erasure")
    a.add_argument("--shots", type=int, default=2000)
    a.add_argument("--seed", type=int, required=True, help="train and test must use different seeds")
    a.add_argument("--decoders", nargs="+", required=True)
    a.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    a.add_argument("--chunk", type=int, default=CHUNK, help="shots per chunk; relay-BP restarts its random stream per chunk")
    a.add_argument("--flag-miss", type=float, default=0.0,
                   help="imperfect detection: each real loss flag is hidden from the decoders with this probability")
    a.add_argument("--flag-false", type=float, default=0.0,
                   help="imperfect detection: each location without a loss raises a false flag with this probability")
    a.add_argument("--flag-window", type=int, default=1,
                   help="uncertain timing: the decoder learns the lost qubit and a window of this many consecutive "
                        "erasure opportunities on it containing the true one (1 = exact timing)")
    a.add_argument("--out", required=True)
    args = a.parse_args()
    if args.shots < 1 or args.workers < 1 or args.chunk < 1 or not 0 < args.p < 1 or not 0 <= args.f <= 1:
        a.error("shots/workers/chunk must be positive; 0 < p < 1 and 0 <= f <= 1")
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
        elif n == "relay_flags":
            H, L, p, hc, nc = out["aware"]
            out["column_map"] = blind_column_map((Hb, Lb), (H, L))
            if (out["column_map"] < 0).any():
                raise ValueError("an aware column has no blind counterpart")
            dec[n] = None   # rebuilt per shot (17 ms) because relay-BP has no prior update
        else:
            raise ValueError(f"unknown decoder {n}")
    return out, dec


CHUNK = 50
_built = {}   # per worker process: (circuit text, basis, decoders) -> (matrices, decoders)


def chunk_bounds(shots, chunk=CHUNK):
    """[start, stop) of every chunk: fixed size, independent of the number of workers."""
    return [(a, min(a + chunk, shots)) for a in range(0, shots, chunk)]


def work(job):
    """Decode one chunk of shots with every requested decoder.

    Matrices and decoders are built once per worker process. relay-BP is rebuilt at the start of
    every chunk so that its random stream, and therefore its answers, depend only on the chunk.
    BP and BP-OSD are deterministic; the *_flags decoders get their priors set per shot.
    """
    circuit_text, basis, names, syn, obs, fired_lists = job[:6]
    weight_lists = job[6] if len(job) > 6 else [None] * len(syn)
    import stim
    threadpool_limits(limits=1)
    key = (circuit_text, basis, tuple(names))
    if key not in _built:
        _built.clear()
        _built[key] = build(stim.Circuit(circuit_text), basis, names)
    mats, dec = _built[key]
    if "relay" in dec:
        dec["relay"] = relay_decoder(*mats["blind"][::2])
    n = len(syn)
    res = {}
    for name, d in dec.items():
        flags = name.endswith("_flags")
        H, L, p, hc, nc = mats["aware"] if flags else (*mats["blind"], None, None)
        if name == "relay_flags":
            L = mats["blind"][1]
        fail, secs, conv = np.zeros(n, bool), np.zeros(n), np.zeros(n, bool)
        for k in range(n):
            t = time.perf_counter()     # the per-shot prior update counts as decode time
            if name == "relay_flags":
                d = relay_decoder(mats["blind"][0], fold_priors(shot_priors(p, hc, fired_lists[k], nc, weight_lists[k]), mats["column_map"], mats["blind"][0].shape[1]))
            elif flags:
                d.update_channel_probs(shot_priors(p, hc, fired_lists[k], nc, weight_lists[k]))
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
    if a.flag_miss or a.flag_false:   # the decoders see a noisy copy; the true flags are still saved
        rng = np.random.default_rng([a.seed, 7919])
        seen = []
        for k in range(a.shots):
            real = det[k, hid] == 1
            shown = (real & (rng.random(len(hid)) >= a.flag_miss)) | (~real & (rng.random(len(hid)) < a.flag_false))
            seen.append(hid[shown])
    else:
        seen = fired
    weights = [None] * a.shots
    if a.flag_window > 1:
        rng = np.random.default_rng([a.seed, 104729])
        hq = herald_qubits(circuit)
        pos = {d: i for i, d in enumerate(hid)}
        windowed = [timing_window_flags(np.array([pos[d] for d in s], int), hq, a.flag_window, rng) for s in seen]
        seen = [hid[w[0]] for w in windowed]
        weights = [w[1] for w in windowed]
    text = str(circuit)
    jobs = [(text, a.basis, a.decoders, syn[lo:hi], obs[lo:hi], seen[lo:hi], weights[lo:hi]) for lo, hi in chunk_bounds(a.shots, a.chunk)]
    start = time.time()
    with Pool(min(a.workers, len(jobs))) as pool:
        parts = pool.map(work, jobs, chunksize=1)   # results come back in chunk order
    save = {"p": a.p, "f": a.f, "seed": a.seed, "basis": a.basis, "shots": a.shots,
            "round_weights": syn.reshape(a.shots, -1, 72).sum(axis=2),
            "n_flags": np.array([len(x) for x in fired]),
            "n_flags_seen": np.array([len(x) for x in seen]), "flag_miss": a.flag_miss, "flag_false": a.flag_false, "flag_window": a.flag_window,
            "sample_sha256": hashlib.sha256(det.tobytes() + obs.tobytes()).hexdigest(),
            "provenance_json": json.dumps({"python": platform.python_version(),
                "platform": platform.platform(), "workers": a.workers, "chunk": a.chunk, "threads_per_worker": 1,
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
