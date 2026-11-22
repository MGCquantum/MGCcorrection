#!/usr/bin/env bash
# Verify the QEC-Aegis extension and the kit it builds on. Run from any directory after installing
# challenge-1-ml-decoder-kit/requirements-dev.txt into .venv at the repository root.
#
#   scripts/reproduce.sh            kit tests, aegis tests, sampling check of every committed record,
#                                      then regenerate reports, results/tables.md and results/figures
#   DECODE=1 scripts/reproduce.sh   also re-decode one chunk per record and tier, bit for bit (slow)
#   RESOURCES=1 scripts/reproduce.sh  also re-measure per-decoder memory and setup on this machine
#
# No step trains a model or decodes test shots for evaluation: the frozen models in models/ and the
# committed records in data/ are only read.
set -euo pipefail
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
PY=.venv/bin/python
mkdir -p results/logs
(cd challenge-1-ml-decoder-kit && "../$PY" -m pytest -q test_kit.py test_submission.py) | tee results/logs/kit_tests.log
"$PY" -m pytest | tee results/logs/aegis_tests.log
shasum -a 256 -c <("$PY" -c "import json; d=json.load(open('results/frozen_models.json'));
print('\n'.join(f'{h}  models/{f}' for f, h in d['models'].items()))")
shasum -a 256 -c <("$PY" -c "import json; d=json.load(open('results/v2_frozen.json'));
print('\n'.join(f'{h}  {f}' for f, h in d['models'].items()))")
"$PY" -m aegis.reproduce --decode "${DECODE:-0}" | tee results/logs/reproduce.log
"$PY" -m aegis.recheck
if [ "${RESOURCES:-0}" = 1 ]; then "$PY" -m aegis.resources; fi
"$PY" -m aegis.evaluate > results/logs/evaluate.log
"$PY" -m aegis.evaluate_v2 > results/logs/evaluate_v2.log
"$PY" -m aegis.report
"$PY" -m aegis.figures
git --no-pager diff --stat -- results/ docs || true
