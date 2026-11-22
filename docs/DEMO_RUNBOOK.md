# Demo runbook (MidQWest 2026)

Runs entirely on the laptop. No internet, IBM account or new hardware job is needed for any step. The live IBM
panel on `/hardware` shows the last stored connection check, labelled with its age.

## Before the judges arrive (5 minutes)

```bash
cd ~/MGCquantum/MidQWest-2026
make dev-stop                 # stop anything left over
make dev                      # :8765 QEC-Aegis API, :8000 MidQwest simulation API, :3100 research lab
./scripts/dev.sh status       # all three "up"
open http://127.0.0.1:3100/
```

Optional, only with internet: refresh the IBM status snapshot (read-only; submits nothing):

```bash
cd ~/MidQwest && .venv/bin/python scripts/ibm_connection_status.py
```

Checklist:

- [ ] `http://127.0.0.1:3100/results` shows the state **Completed** (green), not Partial or Running
- [ ] `/hardware` §8.1 shows Connected (if refreshed today) or Unknown with the age of the last check. Either is honest
- [ ] Close every other heavy app. The live decodes on `/experiments` take ~0.1–2 s per shot
- [ ] Browser zoom 100%, window ≥ 1280 px wide. The lab also works at phone width

If a backend dies mid-demo, the affected panel shows "The backend is not reachable". Run `make dev` again; it starts
only what is down, in about 4 s.

## The three-minute demonstration

| Time | Page | Do | Say |
|---|---|---|---|
| 0:00 | `/foundations` | Drag the Bloch-sphere angles; apply X, then the depolarizing channel | "A qubit is a point on this sphere. Noise shrinks it towards the centre, and that lost information is a physical error. Real devices make about one error per few hundred operations." |
| 0:25 | `/error-correction` | Inject an X error on the distance-3 repetition code | "Error correction spreads one logical qubit over many physical ones. Stabilizer checks report a *syndrome*, which says where the error is without measuring the data." |
| 0:45 | `/surface-code` | Inject an error at d = 5; show the matching | "The surface code is today's standard: about 2d² qubits for distance d. Decoding is matching defects in space-time." |
| 1:05 | `/gross-code` | Show the Tanner graph and the rank card (k = 12) | "IBM's Gross code [[144,12,12]] stores 12 logical qubits in 144 physical ones at distance 12. A surface code needs roughly 10× more qubits for the same protection. The price is long-range checks and a much harder decoding problem: a 936 × 8,784 check matrix per basis." |
| 1:30 | `/decoders` → `/experiments` | Run one live Gross-code shot at p = 0.004; point at the router's features and the escalation decision | "BP-OSD is accurate but slow. Relay-BP is faster. QEC-Aegis runs a cheap early-stopping relay-BP first, and a learned risk model decides per shot whether to escalate to full relay-BP. The model was frozen on validation data before the test set was decoded." |
| 2:00 | `/results` | Fig. 7.F1 at p = 0.004, then the paired-comparison and single-worker latency tables | State the measured result exactly as the table shows it, including any accuracy cost. See "What the results say" below |
| 2:40 | `/hardware` | §8.1 live panel, then §8.2 the archived job | "Our IBM account is live: these are the real QPUs it can reach right now. Execution is disabled in this app on purpose. Separately, this archived ibm_kingston job ran our pipeline on real hardware; its checksums are verified live." |
| 3:00 | | | "Everything you saw is reproducible with one command, and every number carries its provenance label." |

### What the results say

Fill this in from `docs/RESULTS.md` (generated) after the frozen evaluation completes; see `docs/SCIENTIFIC_VALIDATION.md` §5.

## Questions judges are likely to ask

- **"Is this real hardware?"** Only Module 8 §8.2 is, and it is one archived job. Everything else is local simulation
  (Stim, Aer) or exact mathematics, and each panel says which.
- **"Did you tune on the test set?"** No. The model hashes in `experiments/reports/frozen_models.json` were recorded
  before the routed decoder saw a test shot. `aegis.train` never reads test records (`tests/test_aegis.py::test_training_never_reads_test_records`).
- **"Why is the distance 12?"** It is the published value (Bravyi et al., Nature 2024). We rebuild the code independently,
  verify k = 12 and the CSS condition, and prove d ≥ 4 by exhaustive search (`tests/test_science.py`). We did not
  recompute d = 12, which is an NP-hard search.
- **"What is the oracle row?"** A router that knows the truth. It bounds what any router with the same two decoders could
  achieve. It cannot be built.

## Reproduce every number

```bash
make setup                    # .venv from requirements.lock
make test                     # Python tests (~2 min idle; 101 tests)
make lab-test                 # lab type check, unit tests, build, Playwright (needs make dev)
make evaluate-frozen          # train -> frozen test records -> online -> timing -> evaluate -> figures -> report (hours, resumable)
make evaluate figures         # recompute tables and figures from cached records (seconds)
cd ~/MidQwest && .venv/bin/python -m pytest          # 238+ tests incl. read-only IBM checks; --offline skips those
cd ~/MidQwest && .venv/bin/python scripts/archive_job.py dc0kvf2nj2vs73de5qvg --verify   # hardware archive checksums
```
