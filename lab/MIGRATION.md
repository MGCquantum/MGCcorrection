# Migration of the legacy dashboards into the research lab

The research lab (`http://127.0.0.1:3100`) replaced two legacy pages:

- the QEC-Aegis page served by `dashboard/server.py` on :8765 (this repository, `dashboard/index.html`)
- the MidQwest page served by `dashboard/serve.py` on :8000 (MidQwest repository, `dashboard/static/`)

Both servers remain as the lab's API backends, and their `/` now redirects to the lab. After every
legacy feature passed the parity checks below, **the legacy pages and the code and tests that existed
only for them were removed** (2026-11-21). For rollback, the last versions are in git:
MidQWest-2026 commit `c333d94` (`dashboard/index.html`, `lab/e2e/parity.spec.ts`) and MidQwest
commit `7f62129` (`dashboard/static/`, `tests/test_dashboard_e2e.py`).

## How parity was verified

Before removal, `lab/e2e/parity.spec.ts` (in `c333d94`) started both legacy pages from the same code on
their own ports. For each feature, the legacy page made a request, the lab replayed the same request
(same seed), and the test asserted that the responses were identical and that both pages displayed the
same values. All 4 parity tests passed, together with the other 19 browser tests (23/23).
`lab/e2e/migration.spec.ts` keeps a regression test for every migrated feature.

## Feature-parity matrix

| Legacy page | Feature | Where in the lab | Verified by | Status |
|---|---|---|---|---|
| :8000 | Experiment choice: code, distance, basis, rounds | Modules 2, 3 | lab.spec M2/M3, parity 1 | PASS |
| :8000 | Inject a known X/Y/Z error on a chosen data qubit and time, run on Aer, decode with PyMatching | Module 2 (repetition), Module 3 (surface) | parity 1 (identical response, same displayed values) | PASS |
| :8000 | Lattice with the checks that fired | Module 3 | lab.spec M3, migration P2 | PASS |
| :8000 | Circuit diagram with the injected error and the fired measurements | Modules 2, 3 (`components/Circuit.tsx`) | parity 1 (identical drawing, error count), migration P2 (column and row of the error, fired-gate count) | PASS |
| :8000 | Circuit size as written and compiled for IBM heavy-hex, routing overhead | Modules 2, 3 (labeled as a local estimate, not an execution) | parity 1 (depth, two-qubit gates, overhead), migration P2 | PASS |
| :8000 | Syndrome by round | Module 2 grid, Module 3 space-time record | lab.spec M2/M3 | PASS |
| :8000 | Result details: fired detectors, errors before and after decoding, Stim cross-check, first-shot raw bits, run id, seed, timing | Modules 2, 3 | parity 1, lab.spec M2 | PASS |
| :8000 | Logical-error-rate sweep: noise model, p range, points, shots, chart and table | Module 6 (B) | lab.spec M6 (every table row equals the response) | PASS |
| :8000 | Stored 2,000,000-shot validation study | Module 3, Fig. 3.1 | lab.spec (renders from /api/reference) | PASS |
| :8000 | Aer against Stim comparison | Module 6 (C) | lab.spec M6 | PASS |
| :8000 | IBM hardware archive: job, checksums, re-decode, tiles, detector rates, records, calibration | Module 8 (adds the SHA-256 values) | parity 4, lab.spec M8 | PASS |
| :8000 | Backend status and versions | sidebar | lab.spec | PASS |
| :8765 | One memory experiment: basis, p, erasure fraction, seed, baselines, next seed | Module 6 (A), Module 5 | parity 2 (identical shot, predictions, iterations, outcomes) | PASS |
| :8765 | Syndrome raster with heralds per round | Module 6 (A), Module 4 overlay | lab.spec M6, M4 | PASS |
| :8765 | Decoder comparison table | Module 6 (A), Module 5 | parity 2 | PASS |
| :8765 | Router decision: path, risk against threshold | Module 5 (risk bar, route, threshold, fallback rule) | parity 2, migration P1 | PASS |
| :8765 | Every feature the risk model read | Module 5, grouped as the model sees them | parity 2 (same count, same values), migration P1 | PASS |
| :8765 | Decoder study: BP-OSD against relay-BP shot by shot | Module 5, Fig. 5.1 | parity 3, migration P1 | PASS |
| :8765 | Tiers, routing rules and perfect-router bounds (legacy showed a subset; the lab shows all) | Module 5, Fig. 5.2 | parity 3, migration P1 | PASS |
| :8765 | Rejected learned predecoder | Module 5, Fig. 5.4 (with the methodology from `aegis/predecoder.py`) | parity 3, migration P1 | PASS |
| :8765 | Frozen-test evaluation tables (sweep, latency, erasure) | Module 7, section 7.0 (pending / running / failed / partial / completed) | migration P0 (all five states; the completed view against a schema-identical fixture) | PASS (feature) |
| :8765 | Final figures from `docs/figures` | Module 7, section 7.0 gallery (proxied from :8765) | code path only: no figure exists yet | PASS (feature), untested with real images |
| :8765 | Starter-kit reference results | Module 7, Fig. 7.1 (hollow reference points, data table) | lab.spec | PASS |
| :8765 | "How it works" schematic | Module 5 (equations 5.1–5.8 and the routing description) | — | PASS |

New in the lab, with no legacy counterpart: router model ranking and chosen thresholds (Fig. 5.3), the
architecture rationale with quoted numbers, live pipeline progress for the frozen evaluation, the
Gross-code Tanner graph and DEM, MWPM visualization, and Modules 1–2.

## Remaining gaps

| Gap | Why | What closes it |
|---|---|---|
| **No frozen-test results exist yet** | The test-set pipeline stopped at `test_Z_p0.004` (87 of 200 chunks). The erasure router is not trained, and the online, timing and evaluate steps have never run. | `make evaluate-frozen` (several hours, resumable). The lab shows its progress and switches to the final view only when `aegis.evaluate` covers every setting. |
| Final-figure gallery not exercised with real images | `aegis.figures` has not run (it needs the evaluation) | Same pipeline: its `figures` step |
