#!/usr/bin/env bash
# QEC-Aegis v2 on fresh shots. Run after `python -m aegis.retune` has written and frozen models/v2/.
# Resumable: aegis.collect checkpoints every chunk and skips tiers a record already holds.
#
#   scripts/run_v2_fresh.sh test     test2 (seed 7): baselines, v1 and v2 online, 8 workers  (~2.5 h)
#   scripts/run_v2_fresh.sh timing   timing2 (seed 8): one worker, run with nothing else running (~1 h)
#   scripts/run_v2_fresh.sh all      both, test first
set -euo pipefail
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
PY=.venv/bin/python
C="$PY -m aegis.collect"
shasum -a 256 -c <("$PY" -c "import json; d=json.load(open('experiments/reports/v2_frozen.json'));
print('\n'.join(f'{h}  {f}' for f, h in d['models'].items()))") > /dev/null

shots() { case "$1" in 0.003) echo 30000;; 0.004) echo 10000;; 0.005) echo 5000;; esac; }
tshots() { case "$1" in 0.003) echo 2000;; 0.004) echo 1000;; 0.005) echo 500;; esac; }

run_split() {   # split workers shots-function
  local split=$1 workers=$2 count=$3
  for p in 0.003 0.004 0.005; do
    n=$($count $p)
    $C --split "$split" --p $p --shots $n --workers $workers --tiers bposd relay
    $C --split "$split" --p $p --shots $n --workers $workers --tiers aegis-v1 --model models/aegis_router.joblib
    for mode in speed accuracy; do
      $C --split "$split" --p $p --shots $n --workers $workers --tiers aegis2-$mode --model models/v2/aegis_${mode}_p$p.joblib
    done
  done
}

test_split() {
  run_split test2 8 shots
  for f in 0.25 0.5 0.75; do
    $C --split test2 --p 0.004 --f $f --shots 5000 --tiers bposd+flags relay+flags
    $C --split test2 --p 0.004 --f $f --shots 5000 --tiers aegis-v1+flags --model models/aegis_router_loss.joblib
    for mode in speed accuracy; do
      $C --split test2 --p 0.004 --f $f --shots 5000 --tiers aegis2-$mode+flags --model models/v2/aegis_${mode}_p0.004_f$f.joblib
    done
  done
}

case "${1:-all}" in
  test) test_split ;;
  timing) run_split timing2 1 tshots ;;
  all) test_split; run_split timing2 1 tshots ;;
  *) echo "usage: $0 test|timing|all" >&2; exit 2 ;;
esac
"$PY" -m aegis.evaluate_v2
