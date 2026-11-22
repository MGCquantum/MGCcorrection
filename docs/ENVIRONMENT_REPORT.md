# Environment validation report

Machine: MacBook, Apple M5 (arm64), 10 cores, 16 GB, macOS 26.5.1. Date: 2026-11-21.
Every PASS below was executed on this machine on that date. Setup steps are in `docs/SETUP.md`.

## Components

Project environment: `/Users/agentq/MGCquantum/MidQWest-2026/.venv` (Python 3.12.16).

| Component | Version | Status | Notes | Action |
|---|---|---|---|---|
| macOS / CPU | 26.5.1 / arm64 (Apple M5) | PASS | | none |
| Python (project) | 3.12.16 | PASS | standalone build under `.toolchain/`, installed with uv; the system has only 3.9.6 and Homebrew 3.13.15 | none |
| Python 3.13 cross-check | 3.13.15 | PASS | same 40 tests pass | none |
| pip | 26.3 | PASS | `pip check`: no broken requirements | none |
| Homebrew | 7.0.13 | PASS | not used for this setup | none |
| Rust / Cargo | 1.100.0 | PASS | installed in `.toolchain/`, not on the global PATH | none |
| Git | 2.50.1 | PASS | | none |
| GitHub CLI | 2.83.1 | PASS | logged in as AgentQ1, admin on MGCquantum/MGCcorrection | none |
| VS Code / Claude Code | 1.147.0 / 2.1.263 | PASS | | none |
| Stim | 1.16.0 | PASS | | none |
| ldpc (BP-OSD) | 2.4.1 | PASS | | none |
| relay-bp | 0.2.2 | PASS | built from source with Rust | none |
| NumPy / SciPy | 2.5.5 / 1.18.1 | PASS | same versions as the MidQwest environment | none |
| PyMatching / sinter | 2.4.0 / 1.16.0 | PASS | installed as dependencies of ldpc | none |
| scikit-learn | 1.9.1 | PASS | imports; used by `analyze.py` | none |
| Matplotlib | 3.11.2 | PASS | imports | none |
| pytest | 9.2.0 | PASS | | none |
| Qiskit / Aer / IBM Runtime | 2.6.2 / 0.18.4 / 0.52.1 | PASS | in `/Users/agentq/MidQwest/.venv` only; that environment's own diagnostics pass 26 of 26 | none |
| FastAPI | 0.165.0 | PASS (installed) | MidQwest environment only; not needed here | none |
| Graphviz / pydot | 16.1.1 / 4.0.1 | PASS | MidQwest environment; PNG rendering checked by its diagnostics | none |
| IBM Cloud CLI | 2.49.0 | PASS (installed) | login state not checked | optional |
| IBM Quantum saved account | n/a | NOT TESTED online | credentials file exists with permissions 600; contents not read, no connection made | optional |
| GitHub Actions workflow | n/a | NOT TESTED | written, never run: the branch has not been pushed | push the branch |

## Tests

| Command | Result |
|---|---|
| `.venv/bin/python -m pytest` (Python 3.12) | 40 passed: 17 environment tests, 23 kit tests |
| same on Python 3.13.15 | 40 passed |
| `.venv/bin/python scripts/diagnose.py` | 21 passed, 0 warnings, 0 failures |
| `./scripts/setup_env.sh` end to end | completed; diagnostics and tests pass |
| fresh environment from `requirements.lock` | installs; `pip freeze` equals the lock |
| `run_job.py --shots 50 --decoders bp relay` (TEAM_PLAN.md step 3) | ran; bp 7 failures, relay 0 |
| `run_job.py --f 0.5 --shots 30 --decoders bposd bposd_flags` | ran; 0 failures each |
| MidQwest `scripts/diagnose.py` (offline) | 26 passed |
| MidQwest `scripts/verify_stack.py` | 11 of 11 passed |

The MidQwest repository was only read. Its working tree is unchanged.

## Baselines

Pair failures as [X Z] of the shots per basis. Reference values are from the kit README.

| p | Shots | Decoder | Failures | Rate per cycle | Reference rate | Mean time | p99 |
|---|---|---|---|---|---|---|---|
| 0.004 | 1,000 | BP-OSD | [34 27] | 5.1e-3 +- 0.7e-3 | 4.4e-3 +- 0.2e-3 | 269 ms | 764 ms |
| 0.004 | 1,000 | relay-BP | [5 6] | 9.2e-4 +- 2.8e-4 | 8.7e-4 +- 0.9e-4 | 288 ms | 4,457 ms |
| 0.004 | 10,000 | BP-OSD | [266 267] | 4.50e-3 +- 0.20e-3 | 4.4e-3 +- 0.2e-3 | 280 ms | 812 ms |
| 0.004 | 10,000 | relay-BP | [52 40] | 7.7e-4 +- 0.8e-4 | 8.7e-4 +- 0.9e-4 | 296 ms | 4,927 ms |
| 0.003 | 10,000 | BP-OSD | [36 23] | 4.9e-4 +- 0.6e-4 | 4.7e-4 +- 0.6e-4 | 100 ms | 640 ms |
| 0.003 | 10,000 | relay-BP | [3 2] | 4.2e-5 +- 1.9e-5 | 4.2e-5 +- 1.9e-5 | 69 ms | 458 ms |

All six rates agree with the reference within about one standard error.

Resources, p = 0.004 with 8 workers:

| Shots | Wall time | CPU time | Average cores busy | Peak memory of one process |
|---|---|---|---|---|
| 1,000 | 87 s | 557 s | 6.4 | 160 MB |
| 10,000 | 761 s | 5,700 s | 7.5 | 179 MB |

Caveats:
- The 10,000-shot run at p = 0.004 shared the machine with a test run for about two minutes, so
  its times are slightly high. The failure counts are not affected.
- The p = 0.003 run was made earlier in the Python 3.13 environment with 5 workers while other
  jobs were running. Its failure counts are valid; its times are not a clean measurement.
- p = 0.005 has not been run. It takes about an hour on 8 cores.

Full sweep:

```bash
./scripts/run_baseline_sweep.sh              # p = 0.003, 0.004, 0.005, 10,000 shots per basis
P="0.005" ./scripts/run_baseline_sweep.sh    # only the missing point
```

## Dataset generation

PASS. `make_dataset.py` writes 1728 detector bits and 12 observable bits per shot with the
requested p and seed (`tests/test_environment.py::test_07_dataset_generation`). Sampling with the
same seed gives identical shots (`test_09`).

## IBM Quantum (optional)

- SDK: qiskit 2.6.2, qiskit-aer 0.18.4, qiskit-ibm-runtime 0.52.1 in the MidQwest environment. CLI: ibmcloud 2.49.0.
- A saved account file exists at `~/.qiskit/qiskit-ibm.json` with permissions 600. It was not opened.
- No login, no network call to IBM and no job submission was made. Whether the saved key and the
  CLI session are still valid is therefore unknown. This does not affect local simulation.

## Open items

1. p = 0.005 baseline not yet run (about 1 hour).
2. The CI workflow has not run, because the branch `setup/environment-validation` is local only.
3. `git config user.name` is not set in this repository; commits here pass the name explicitly.
