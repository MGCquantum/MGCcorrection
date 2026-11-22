# Setup

How to build and check the development environment for MGCcorrection. Everything here runs
locally. No quantum hardware or cloud account is needed.

## Requirements

| Need | Version | Notes |
|---|---|---|
| Python | 3.12 (3.13 also passes every test) | the starter kit was tested with 3.12 |
| Rust | any recent stable | only to build `relay-bp`, which has no prebuilt wheel |
| Git | any | |

## Install

```bash
git clone https://github.com/MGCquantum/MGCcorrection
cd MGCcorrection
./scripts/setup_env.sh
```

The script creates `.venv`, installs the exact versions in `requirements.lock`, then runs the
diagnostics and the tests. It finishes with `21 passed, 0 warnings, 0 required failures` and
`40 passed`.

If Python 3.12 or Rust is missing:

```bash
# Python 3.12, without touching the system Python
pip install uv            # or: brew install uv
uv python install 3.12
PYTHON="$(uv python find 3.12)" ./scripts/setup_env.sh

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh     # then open a new terminal
```

By hand, the script does this:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.lock
```

`requirements-dev.txt` lists the direct dependencies without pins. `./scripts/setup_env.sh --latest`
installs from it. After changing versions, regenerate the lock with
`.venv/bin/python -m pip freeze --exclude pip --exclude setuptools --exclude wheel`.

`TEAM_PLAN.md` step 2 creates the environment inside `challenge-1-ml-decoder-kit/` instead. Both
work. With the environment at the repository root, activate it with `source ../.venv/bin/activate`
from the kit folder, and every command in `TEAM_PLAN.md` and `RUN.md` runs unchanged.

## Check

```bash
.venv/bin/python scripts/diagnose.py     # one PASS/FAIL line per component, about 5 s
.venv/bin/python -m pytest               # environment tests + the kit's tests, about 45 s
```

`tests/test_environment.py` has one test per item: circuit loading, X and Z memory sampling,
detector syndromes, the detector error model, BP-OSD, relay-BP, dataset generation, observable
scoring, seed determinism and noise-strength configuration.

## Baselines

```bash
SHOTS=1000 P="0.004" ./scripts/run_baseline_sweep.sh     # quick check, about 90 s on 8 cores
./scripts/run_baseline_sweep.sh                          # required sweep, 10,000 shots per basis
```

The full sweep covers p = 0.003, 0.004 and 0.005 and takes about 1.5 hours on 8 cores, most of it
at p = 0.005. Logs go to `results/baseline_logs/` with wall time, CPU time and peak memory.
Expected numbers are in `challenge-1-ml-decoder-kit/README.md`; measured ones are in
`docs/ENVIRONMENT_REPORT.md`.

## Layout

| Path | Contents | Committed |
|---|---|---|
| `challenge-1-ml-decoder-kit/` | official starter kit (unchanged) and the team's `run_job.py`, `lossy.py`, `analyze.py` | yes |
| `challenge-1-ml-decoder-kit/results/` | per-shot decoder records, read by `analyze.py` | only with `git add -f` (TEAM_PLAN.md step 6) |
| `mgccorrection/` | shared paths and logging | yes |
| `scripts/` | setup, diagnostics, baseline sweep | yes |
| `tests/` | environment tests | yes |
| `data/` | generated datasets; see `data/README.md` | no |
| `results/baseline_logs/` | baseline run logs | no |
| `logs/` | script logs from `mgccorrection.logs.get_logger` | no |
| `.venv/`, `.toolchain/` | environment and local toolchains | no |

Seeds follow `TEAM_PLAN.md`: 1 for training data, 2 for test data. `baseline.py` uses seed 1 for X
memory and seed 2 for Z memory by default.

## Continuous integration

`.github/workflows/ci.yml` runs the diagnostics and the tests on Python 3.12 and 3.13 for every
pull request and every push to `main`.

## IBM Quantum

Not needed for this challenge. The Qiskit and IBM Runtime stack lives in a separate environment
in the `AgentQ1/MidQwest` repository and is not installed here. Hardware runs need explicit
approval first.
