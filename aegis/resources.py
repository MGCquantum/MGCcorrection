"""Resource requirements of each decoder, measured one decoder per fresh process.

  python -m aegis.resources              BP-OSD, relay-BP and QEC-Aegis at p = 0.003, 0.004, 0.005, X and Z
  python -m aegis.resources --shots 20

For every (decoder, p, basis) a new Python process loads the decoding problem (circuit, detector
error model, check matrix), records its peak resident memory, builds the decoder (and, for
QEC-Aegis, loads the frozen risk model), decodes a few shots, and records peak memory again.
Numerical libraries run single-threaded, as in every benchmark here.

Reported per row: check-matrix size, problem build time, one-time library import (scikit-learn, for
QEC-Aegis only), decoder setup time (building the decoders and loading the model), peak process memory,
the memory the decoder adds on top of the problem, model file size and per-shot inference time.
The shots come from seed 6, which no other split uses; their decode times are a sanity check, not
a latency benchmark (use the timing records for that). Writes experiments/reports/resources.json.
"""
import argparse
import json
import os
import platform
import resource
import subprocess
import sys
import time

DECODERS = ("bposd", "relay", "aegis")
SEED = 6
MODEL = "aegis_router.joblib"


def peak_mb():
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return rss / 2**20 if sys.platform == "darwin" else rss / 2**10   # bytes on macOS, KiB on Linux


def machine():
    """Where the numbers were measured: chip, cores, memory, OS and Python."""
    def sysctl(key):
        try:
            return subprocess.run(["sysctl", "-n", key], capture_output=True, text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            return None
    chip = sysctl("machdep.cpu.brand_string") if sys.platform == "darwin" else platform.processor() or None
    ram = sysctl("hw.memsize") if sys.platform == "darwin" else None
    if ram is None and hasattr(os, "sysconf"):
        try:
            ram = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
        except (ValueError, OSError):
            ram = None
    return {"chip": chip, "cores": os.cpu_count(), "memory_gb": round(int(ram) / 2**30) if ram else None,
            "platform": platform.platform(), "python": platform.python_version()}


def measure(decoder, p, basis, shots):
    """One measurement in this process; call it in a fresh process."""
    from threadpoolctl import threadpool_limits
    threadpool_limits(limits=1)
    import joblib

    from .decoder import AegisDecoder
    from .paths import MODELS
    from .problem import Problem
    from .tiers import build

    start = time.perf_counter()
    problem = Problem(basis, p)
    problem_s = time.perf_counter() - start
    problem_mb = peak_mb()
    import_s = None
    if decoder == "aegis":
        start = time.perf_counter()
        import sklearn.ensemble  # noqa: F401  (once per process; the risk model needs it)
        import_s = time.perf_counter() - start
    start = time.perf_counter()
    model_kb = inference_us = None
    if decoder == "aegis":
        model = joblib.load(MODELS / MODEL)
        model_kb = (MODELS / MODEL).stat().st_size / 1024
        inference_us = model.meta["inference_seconds"] * 1e6
        dec = AegisDecoder(problem, model)
        parts = f"{model.meta['tier1']} + risk model + {model.meta['tier2']}"
    else:
        dec = build(decoder, problem)
        parts = decoder
    setup_s = time.perf_counter() - start
    syndromes, other, _, fired = problem.sample(shots, SEED)
    seconds = []
    for k in range(shots):
        start = time.perf_counter()
        dec.decode_shot(syndromes[k], int(other[k].sum()), fired[k])
        seconds.append(time.perf_counter() - start)
    peak = peak_mb()
    return {"decoder": decoder, "parts": parts, "p": p, "basis": basis,
            "checks": int(problem.H.shape[0]), "mechanisms": int(problem.H.shape[1]), "nonzeros": int(problem.H.nnz),
            "problem_build_s": problem_s, "import_s": import_s, "decoder_setup_s": setup_s,
            "problem_peak_mb": problem_mb, "peak_mb": peak, "decoder_added_mb": peak - problem_mb,
            "model_kb": model_kb, "inference_us": inference_us, "threads": 1,
            "sanity_shots": shots, "sanity_mean_ms": 1e3 * sum(seconds) / shots}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--shots", type=int, default=10)
    parser.add_argument("--one", nargs=3, metavar=("DECODER", "P", "BASIS"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.one:
        decoder, p, basis = args.one
        print(json.dumps(measure(decoder, float(p), basis, args.shots)))
        return 0
    from .paths import REPORTS, ROOT
    from .train import SWEEP
    env = os.environ | {"OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1", "VECLIB_MAXIMUM_THREADS": "1"}
    rows = []
    for p in SWEEP:
        for decoder in DECODERS:
            for basis in "XZ":
                out = subprocess.run([sys.executable, "-m", "aegis.resources", "--shots", str(args.shots), "--one", decoder, str(p), basis],
                                     cwd=ROOT, env=env, check=True, capture_output=True, text=True)
                row = json.loads(out.stdout.strip().splitlines()[-1])
                rows.append(row)
                print(f"p={p} {basis} {decoder:6s} H {row['checks']}x{row['mechanisms']}  setup {row['decoder_setup_s']:.2f} s  "
                      f"peak {row['peak_mb']:.0f} MB (decoder adds {row['decoder_added_mb']:.0f} MB)")
    from importlib import metadata
    report = {"machine": machine(),
              "versions": {pkg: metadata.version(pkg) for pkg in ("stim", "ldpc", "relay-bp", "numpy", "scikit-learn")},
              "seed": SEED, "rows": rows}
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "resources.json").write_text(json.dumps(report, indent=1))
    print("wrote", REPORTS / "resources.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
