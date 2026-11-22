# Error Correction Research Laboratory

A local, interactive laboratory for quantum error correction, built for MidQWest 2026 (Infleqtion Challenge 1:
ML-assisted QEC decoding). It goes from single-qubit physics to IBM's [[144,12,12]] Gross code and to QEC-Aegis,
our ML-routed decoder. Every number on screen is labelled with where it came from: exact theory, live simulation,
stored measurement, published reference, IBM account check, or archived hardware.

Nothing in the laboratory submits work to quantum hardware. Everything runs on one laptop, offline.

## Start it

```bash
make dev                      # http://127.0.0.1:3100/   (make dev-stop to stop)
./scripts/dev.sh status
```

| Service | Port | Code | Role |
|---|---|---|---|
| Research lab (Next.js) | 3100 | `lab/` | The only user interface |
| QEC-Aegis API | 8765 | `dashboard/server.py`, `dashboard/lab_api.py` | Gross code, decoders, QEC-Aegis, stored experiment records |
| Simulation API (FastAPI) | 8000 | companion repository `MidQwest`, `dashboard/server.py` | Repetition and surface codes (Stim, Aer, PyMatching), IBM hardware archive, IBM connection snapshot |

Both APIs redirect `/` to the lab. The lab reaches them through same-origin proxies (`/api/aegis/*`, `/api/sim/*`).

## The eight modules

| # | Page | Content |
|---|---|---|
| 1 | `/foundations` | Qubit states, Bloch sphere, Pauli operators, measurement, Bell states, noise channels (exact) |
| 2 | `/error-correction` | Repetition code, stabilizers, syndromes, distance, logical operators; inject errors |
| 3 | `/surface-code` | Rotated surface code at d = 3 and 5, detectors in space-time, minimum-weight matching |
| 4 | `/gross-code` | Bivariate bicycle construction, check matrices, GF(2) ranks, Tanner graph, 12-cycle memory circuit |
| 5 | `/decoders` | BP, BP-OSD, relay-BP and the learned QEC-Aegis router; the design studies, including the rejected predecoder |
| 6 | `/experiments` | Bounded live simulations on the real backends |
| 7 | `/results` | Frozen-test evaluation: LER per cycle with 95% intervals, paired comparisons, latency, erasure |
| 8 | `/hardware` | Read-only live IBM Quantum account status, and the archived ibm_kingston job (checksum-verified) |

## QEC-Aegis in one paragraph

A fast early-stopping relay-BP decodes every shot first. A gradient-boosted risk model, using features of that
decode, predicts whether the answer is wrong. Only risky or unconverged shots are escalated to full relay-BP. The
model, its threshold and the tier pair were chosen on validation data and frozen before any test shot was decoded
with them. The hashes are in `experiments/reports/frozen_models.json`. Results are reported against BP-OSD, relay-BP,
early-stop relay-BP, a no-ML rule, a hand-picked heuristic, and an oracle router that knows the truth (an unattainable
bound).

## Status

| Item | Status | Where |
|---|---|---|
| Frozen-test evaluation (p = 0.003, 0.004, 0.005; X and Z; erasure f = 0.25, 0.5, 0.75; single-worker timing) | Running; resumable | `make evaluate-frozen`; progress on `/results` |
| Python tests | 101 passed | `make test` |
| Lab: type check, 29 unit tests, production build, 21 browser tests | all pass | `make lab-test` |
| Gross code verified independently (H_X, H_Z, k = 12, CSS, d ≥ 4 exhaustive; d = 12 from the paper) | pass | `tests/test_science.py` |
| IBM Quantum account (read-only check) | Connected, 3 of 3 QPUs operational on the last check | `docs/IBM_CONNECTION_STATUS.md` |
| Archived ibm_kingston job | SHA-256 verified, re-decodes to the stored analysis | `/hardware` §8.2 |

Final numbers are written to `docs/RESULTS.md` by `python -m aegis.report` when the evaluation completes. No result
is typed by hand.

## Documents

- `docs/ARCHITECTURE.md`: how the pieces fit together
- `docs/RESULTS.md`: generated results tables
- `docs/IBM_CONNECTION_STATUS.md`: live IBM check, safety design, reauthentication
- `docs/DEMO_RUNBOOK.md`: setup checklist and the three-minute judge demonstration
- `lab/README.md`: the frontend
- `README.md`: the challenge statement
