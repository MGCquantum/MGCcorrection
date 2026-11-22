#!/usr/bin/env bash
# Run from any directory after installing requirements-dev.txt in the kit .venv.
set -euo pipefail
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
mkdir -p run_records
.venv/bin/python -m pytest -q test_kit.py test_submission.py | tee run_records/tests.log
.venv/bin/python audit_submission.py | tee run_records/challenge1_audit.log
.venv/bin/python analyze.py --dir results | tee run_records/analysis_current.log
.venv/bin/python make_figures.py
for b in X Z; do
  .venv/bin/python demo.py --p 0.004 --basis "$b" | tee "run_records/demo_local_${b}.log"
done
