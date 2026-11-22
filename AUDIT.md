# Challenge 1 readiness audit

Official source: [Infleqtion/MidQWest-2026](https://github.com/Infleqtion/MidQWest-2026),
revision `31ceda8be4949a308d95ec9bc7c32029c80d90d2` (reviewed 2026-11-21).
`CHALLENGE.md` matches that revision's README. The supplied baseline Python files
and Gross-code circuits are unchanged from the sponsor kit.

This is a requirements audit, not a claim that every research hypothesis succeeded.
The second code, sliding windows, and distance scaling are optional stretch goals.

| Required item | Evidence | Initial audit |
|---|---|---|
| Gross-code noisy memory and both baseline decoders | Sponsor circuits, `decoders.py`, saved X/Z results | Present; local kit tests running |
| ML-assisted decoder using syndrome information | `analyze.py` router and `demo.py` live pipeline | Present; unify and verify train/inference behavior |
| Heralding information where applicable | `lossy.py`, paired flag-hidden/flag-used experiment | Present; idealized instant erasure, not persistent atom loss |
| Same-data sweep at 0.003, 0.004, 0.005 against both baselines | `results/test_*.npz` plus compatible extras | Complete after BP-OSD p=0.005 run; automate verification |
| Logical error rate and uncertainty | `results/results.csv`, exact binomial intervals | Present; README p=0.005 baseline stale |
| Decoding latency | Accuracy-cache times and separate 300-pair timing cache | Present but timing cache lacks BP-OSD; provenance needs explicit caveats |
| Resource requirements | `demo.py` reports model size, setup, matrix, RSS, CPU | Needs local run; enforce the reported thread limit |
| Reproducible code and evaluation on GitHub | Kit, run_job, analyze, results | Repair incomplete run guide and dependencies; add a one-command audit |
| Comparison plot | `results/results.png`, `figures/*.png` | Present |
| Short presentation or demo | `PITCH.md`, `demo.py` | Present; verify demo locally and align claims |
| Discuss successes and limitations | README and PITCH | Present; avoid claiming ML is better than the rule |

All new computation is local. Progress is pushed on `codex/challenge1-readiness`.
The prior BP-OSD-only prompt's no-source-edit constraint applied to that completed
run; this broader readiness audit includes source fixes and regression tests.
