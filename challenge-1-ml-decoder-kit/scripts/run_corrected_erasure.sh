#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
mkdir -p results_corrected_erasure
for f in 0.25 0.5 0.75; do
  n=2000; [ "$f" = 0.25 ] && n=1000
  .venv/bin/python -u run_job.py --basis X --p 0.004 --f "$f" --shots "$n" --seed 2 \
    --decoders bposd bposd_flags --workers 3 --out "results_corrected_erasure/erase_X_p0.004_f${f}.npz" &
  xpid=$!
  .venv/bin/python -u run_job.py --basis Z --p 0.004 --f "$f" --shots "$n" --seed 2 \
    --decoders bposd bposd_flags --workers 3 --out "results_corrected_erasure/erase_Z_p0.004_f${f}.npz" &
  zpid=$!
  wait "$xpid"
  wait "$zpid"
  echo "Completed f=$f; results saved separately for validation."
done
