# QEC Research Laboratory (frontend)

A Next.js + TypeScript + Tailwind interface that teaches quantum error correction from first principles
up to decoding the [[144,12,12]] Gross code. It has **no simulation code of its own**: every
scientific value comes from one of two existing local backends, or from closed-form mathematics
evaluated in the browser, and every value is labeled with where it came from.

| Port | Service | Repository | What it computes |
|---|---|---|---|
| 3100 | this lab (`next start`) | MidQWest-2026/lab | exact theory, illustrations, the UI |
| 8765 | QEC-Aegis server (stdlib `http.server`) | MidQWest-2026 `dashboard/server.py` | Gross-code circuits (Stim), BP-OSD (ldpc), relay-BP, QEC-Aegis router, stored records |
| 8000 | MidQwest FastAPI server | MidQwest `dashboard/server.py` | repetition and surface codes d = 3, 5 (Stim, Qiskit Aer, PyMatching), the ibm_kingston archive |

The browser only ever talks to the lab. `next.config.ts` proxies `/api/aegis/*` to :8765 and
`/api/sim/*` to :8000 (override with `AEGIS_API` and `SIM_API`). Neither backend has a path to
IBM Quantum hardware.

## Run

```bash
make dev            # from MidQWest-2026: starts both API backends and the lab
                    #   http://127.0.0.1:3100/   (the only user-facing dashboard)
make dev-stop       # stops what make dev started
make evaluate-frozen   # the frozen-test pipeline; its progress shows in Module 7
```

`make dev` expects the MidQwest checkout at `~/MidQwest` (override with `MIDQWEST_DIR`). `/` on
:8765 and :8000 redirects here. The two legacy dashboard pages were removed after their features
were migrated and verified; see `MIGRATION.md`.

## Modules

| # | Route | Source of its numbers |
|---|---|---|
| 1 | `/foundations` | exact state-vector and Bloch-vector algebra (`lib/quantum.ts`) |
| 2 | `/error-correction` | exact parity algebra; `POST /api/sim/simulate/injection` (Aer + PyMatching), `/circuit`, `/compile` |
| 3 | `/surface-code` | `/api/sim/circuit`, `/simulate/injection`, `/matching-graph`, `/decode-syndrome`, `/reference` |
| 4 | `/gross-code` | `/api/aegis/gross/structure` (computed from the kit's `make_circuit.py`), `/api/aegis/decode` |
| 5 | `/decoders` | in-browser BP / OSD-0 / relay illustration (`lib/bp.ts`, labeled); live `/api/aegis/decode`; studies from `/results`, `/training`, `/methods` |
| 6 | `/experiments` | `/api/aegis/decode`, `/api/sim/simulate/rates`, `/api/sim/simulate/compare` |
| 7 | `/results` | `/api/aegis/evaluation` + `/pipeline` (frozen-test report and live progress), `/records`, `/training`, `/calibration`, `/manifest`, `/reference`, `/aegis-figures/*` |
| 8 | `/hardware` | `/api/sim/hardware` (checksums recomputed, archive re-decoded; read-only) |

## Tests

```bash
npx tsc --noEmit        # types
npx vitest run          # exact-math libraries against known results (Born rule, Bell stabilizers, binomial sums, Wilson = aegis.policy.wilson, GF(2), BP/OSD)
npx playwright test     # browser E2E on a production build (lab.spec, migration.spec)
```

`make lab-test` runs all of it. The E2E suites need `make dev` running and use the installed Chrome
(`channel: "chrome"`).
