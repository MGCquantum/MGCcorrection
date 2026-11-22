"""Environment diagnostics: one PASS / FAIL / WARN line per component.

  .venv/bin/python scripts/diagnose.py [--json]

Local and read-only. It contacts no network service and reads no credentials.
Exit status 1 when a required check fails.
"""
import argparse
import importlib.metadata as metadata
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
REQUIRED = ["stim", "ldpc", "relay-bp", "numpy", "scipy", "pymatching", "sinter", "scikit-learn", "matplotlib", "pytest"]
results = []


def record(name, ok, detail, required=True):
    results.append({"component": name, "status": "PASS" if ok else ("FAIL" if required else "WARN"), "detail": detail})


def check(name, required=True):
    """Decorator: run the function now, record PASS with its return value or FAIL/WARN with the error."""
    def run(function):
        try:
            record(name, True, function(), required)
        except Exception as error:  # a diagnostic must report every failure, not stop at the first
            record(name, False, f"{type(error).__name__}: {error}", required)
    return run


def tool_version(command):
    path = shutil.which(command[0]) or str(ROOT / ".toolchain" / "cargo" / "bin" / command[0])
    env = os.environ | {"RUSTUP_HOME": os.environ.get("RUSTUP_HOME", str(ROOT / ".toolchain" / "rustup"))}
    out = subprocess.run([path, *command[1:]], capture_output=True, text=True, timeout=30, env=env, check=True)
    return f"{(out.stdout or out.stderr).splitlines()[0]} ({path})"


def locked_versions():
    lock = {}
    for line in (ROOT / "requirements.lock").read_text().splitlines():
        if "==" in line and not line.startswith("#"):
            name, version = line.split("==")
            lock[name.lower()] = version
    return lock


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    record("platform", True, f"{platform.platform()} {platform.machine()}, {os.cpu_count()} cores")
    record("python", sys.version_info[:2] in [(3, 12), (3, 13)], platform.python_version() + " (kit tested with 3.12)")
    record("virtual environment", sys.prefix != sys.base_prefix, sys.prefix)

    lock = locked_versions()
    for package in REQUIRED:
        try:
            version = metadata.version(package)
            record(f"package {package}", True, version + (" (matches lock)" if lock.get(package.lower()) == version
                                                          else f" (lock has {lock.get(package.lower())})"))
        except metadata.PackageNotFoundError:
            record(f"package {package}", False, "not installed")

    @check("pip check")
    def _():
        out = subprocess.run([sys.executable, "-m", "pip", "check"], capture_output=True, text=True)
        if out.returncode:
            raise RuntimeError(out.stdout.strip())
        return out.stdout.strip()

    for command in (["rustc", "--version"], ["cargo", "--version"]):
        check(command[0], required=False)(lambda command=command: tool_version(command))
    check("git")(lambda: tool_version(["git", "--version"]))

    import mgccorrection  # noqa: F401  (puts the kit on the import path)
    state = {}

    @check("Stim: Gross code circuits load (X, Z)")
    def _():
        from circuit import GROSS_CIRCUITS, load_circuit
        state["circuits"] = {basis: load_circuit(GROSS_CIRCUITS[basis], p=0.004) for basis in "XZ"}
        return ", ".join(f"{b}: {c.num_qubits} qubits, {c.num_detectors} detectors, {c.num_observables} observables"
                         for b, c in state["circuits"].items())

    @check("Detector error model and decoding matrices")
    def _():
        from circuit import dem_matrices, detector_ids, sample
        circuit = state["circuits"]["X"]
        state["H"], state["L"], state["priors"] = dem_matrices(circuit, "X")
        det, state["obs"] = sample(circuit, 20, seed=3)
        state["det"] = det[:, detector_ids(circuit, "X")]
        return f"H {state['H'].shape}, L {state['L'].shape}"

    def decode_with(factory):
        from decoders import score
        start = time.perf_counter()
        decoder = factory(state["H"], state["priors"])
        failed, seconds = score(decoder.decode, state["L"], state["det"], state["obs"])
        return f"20 shots at p=0.004: {int(failed.sum())} failed, {seconds.mean() * 1e3:.0f} ms per shot, {time.perf_counter() - start:.1f} s"

    @check("BP-OSD decodes")
    def _():
        from decoders import bposd_decoder
        return decode_with(bposd_decoder)

    @check("relay-BP decodes")
    def _():
        from decoders import relay_decoder
        return decode_with(relay_decoder)

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for r in results:
            print(f"{r['status']:5s} {r['component']:45s} {r['detail']}")
        counts = {s: sum(r["status"] == s for r in results) for s in ("PASS", "WARN", "FAIL")}
        print(f"\n{counts['PASS']} passed, {counts['WARN']} warnings, {counts['FAIL']} required failures")
    sys.exit(any(r["status"] == "FAIL" for r in results))


if __name__ == "__main__":
    main()
