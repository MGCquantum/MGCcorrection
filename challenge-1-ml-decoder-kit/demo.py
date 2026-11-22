"""Live demo and resource report: one fresh shot through the ML-routed hybrid decoder.

  python demo.py --p 0.004 --basis X

1. Trains the router on the cached training shots (results_v2/train_*_p<p>.npz, root seed 1).
2. Simulates one NEW shot (seed 99, never seen before).
3. The router reads the alarm counts and picks a path: fast BP (escalating to relay-BP if BP
   does not converge) or straight to relay-BP. The chosen decoders run live.
4. Prints the prediction against the truth, the time per step, and the resources used.
"""
import argparse
import os
import pickle
import platform
import resource
import subprocess
import time

import numpy as np
from hybrid import HybridDecoder, train_router
from threadpoolctl import threadpool_limits

from circuit import GROSS_CIRCUITS, dem_matrices, detector_ids, load_circuit, sample


def cpu_name():
    try:
        if platform.system() == "Darwin":
            return subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
        for line in open("/proc/cpuinfo"):
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return platform.processor() or "unknown"


def peak_mb():
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r / 1e6 if platform.system() == "Darwin" else r / 1e3   # bytes on macOS, KB on Linux


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--p", type=float, default=0.004)
    a.add_argument("--basis", choices=["X", "Z"], default="X")
    a.add_argument("--seed", type=int, default=99)
    a.add_argument("--train-dir", default="results_v2")
    args = a.parse_args()

    trained = train_router(args.train_dir, args.p)
    if trained is None:
        raise ValueError("Missing seed-1 training cache; see RUN.md")
    router, _ = trained
    circuit = load_circuit(GROSS_CIRCUITS[args.basis], args.p)
    H, L, priors = dem_matrices(circuit, args.basis)
    t = time.perf_counter()
    decoder = HybridDecoder(H, priors, router)
    setup_s = time.perf_counter() - t

    det, obs = sample(circuit, 1, args.seed)
    syn = det[0, detector_ids(circuit, args.basis)]
    print(f"New shot (p={args.p}, {args.basis} memory, seed {args.seed}): {int(syn.sum())} alarms over 13 rounds")
    print("  alarms per round:", syn.reshape(-1, 72).sum(1).tolist())
    e = decoder.decode(syn)
    timing = decoder.last
    print(f"Router ({timing['router_s'] * 1e3:.1f} ms): {'easy -> fast BP first' if timing['easy'] else 'hard -> straight to relay-BP'}")
    print(f"Fast BP: {timing['bp_s'] * 1e3:.1f} ms; relay-BP: {timing['relay_s'] * 1e3:.1f} ms; escalated: {timing['escalated']}")
    pred = (L @ np.asarray(e, np.uint8)) % 2
    print("Predicted logical flips:", "".join(map(str, pred)))
    print("True logical flips:     ", "".join(map(str, obs[0])), "->", "CORRECT" if (pred == obs[0]).all() else "WRONG")

    print("\nResources")
    print(f"  CPU: {cpu_name()}, {os.cpu_count()} logical cores; this demo uses 1 thread")
    print(f"  Decoding matrix: {H.shape[0]} checks x {H.shape[1]} error mechanisms, {H.nnz} nonzeros")
    print(f"  Decoder setup time: {setup_s:.2f} s; router model size: {len(pickle.dumps(router)) / 1e3:.0f} kB")
    print(f"  Peak memory of this process: {peak_mb():.0f} MB")


if __name__ == "__main__":
    with threadpool_limits(limits=1):
        main()
