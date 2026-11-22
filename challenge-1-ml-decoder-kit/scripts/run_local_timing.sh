#!/usr/bin/env bash
# All decoders run on the same newly sampled shots, sequentially on one worker.
# Close competing workloads before using these timings as idle-machine evidence.
set -euo pipefail
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
mkdir -p results_local_timing
for p in 0.003 0.004 0.005; do
  for b in X Z; do
    .venv/bin/python -u run_job.py --basis "$b" --p "$p" --shots 300 --seed 2 \
      --decoders bp relay bposd --workers 1 --out "results_local_timing/test_${b}_p${p}.npz"
  done
done
.venv/bin/python -u analyze.py --dir results_local_timing --train-dir results
