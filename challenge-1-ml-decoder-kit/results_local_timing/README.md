# Local timing comparison

Apple M5, Python 3.13; one worker and one numerical thread per decoder job.
300 X/Z shot pairs at each p; test seed 2; seed-1 training from `../results`.
Each file includes BP, relay-BP and BP-OSD on exactly the same samples, a full
sample SHA-256, and runtime provenance. Hybrids are evaluated from those answers.

This run overlapped other computation, including the corrected erasure sweep.
These timings are **under concurrent load**, not idle-machine hardware limits.
The separate historical idle cache is in `../results_timing`.
Use the larger `../results` sweep for accuracy claims.

Regenerate with `bash scripts/run_local_timing.sh` from the kit directory.
Before using a rerun as an idle benchmark, close competing workloads.
