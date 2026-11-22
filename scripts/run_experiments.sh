#!/usr/bin/env bash
# Every decoding run behind the reported results, in order. Each step caches per-shot records and
# skips what is already cached, so the script can be stopped and started again.
#
#   ./scripts/run_experiments.sh data      training, calibration and validation records
#   ./scripts/run_experiments.sh test      frozen test records: required sweep, then erasure
#   ./scripts/run_experiments.sh all       both
#
# About 5 hours on 8 cores in total. Run one at a time: parallel runs distort the decode times.
set -uo pipefail
cd "$(dirname "$0")/.."
C="caffeinate -i .venv/bin/python -u -m aegis.collect"
command -v caffeinate >/dev/null || C=".venv/bin/python -u -m aegis.collect"
FIRST="fast relay1"                                   # candidate first tiers
SWEEP_TIERS="bposd relay fast relay1 strong10 bp200"  # every tier a chosen system may need
LOSS_FIRST="fast+flags relay1+flags"
LOSS_TIERS="bposd relay bposd+flags relay+flags fast+flags relay1+flags strong10+flags"

data() {
  # Validation at p = 0.004 and 0.003 also holds the tiers studied and rejected (aegis.study).
  $C --split val --p 0.004 --shots 3000 --tiers bposd relay relay1 fast fast0 strong strong10 bp30 bp200 --chunk 250
  $C --split val --p 0.003 --shots 4000 --tiers bposd relay relay1 fast fast0 strong strong10 bp30 bp200 --chunk 250
  $C --split train --p 0.004 --shots 40000 --tiers $FIRST --chunk 500
  $C --split calib --p 0.003 0.004 0.005 --shots 10000 --tiers $FIRST --chunk 250
  $C --split train --p 0.003 --shots 60000 --tiers $FIRST --chunk 500
  $C --split train --p 0.005 --shots 30000 --tiers $FIRST --chunk 500
  $C --split val --p 0.005 --shots 2000 --tiers $SWEEP_TIERS
  for f in 0.25 0.5 0.75; do
    $C --split train --p 0.004 --f $f --shots 20000 --tiers $LOSS_FIRST --chunk 500
    $C --split calib --p 0.004 --f $f --shots 5000 --tiers $LOSS_FIRST --chunk 250
  done
}

test_sets() {
  $C --split test --p 0.004 --shots 10000 --tiers $SWEEP_TIERS
  $C --split test --p 0.003 --shots 30000 --tiers $SWEEP_TIERS --chunk 100
  $C --split test --p 0.005 --shots 5000 --tiers $SWEEP_TIERS --chunk 25
  for f in 0.5 0.25 0.75; do
    $C --split test --p 0.004 --f $f --shots 5000 --tiers $LOSS_TIERS
  done
}

case "${1:-all}" in
  data) data ;;
  test) test_sets ;;
  all) data; test_sets ;;
  *) echo "usage: $0 [data|test|all]" >&2; exit 1 ;;
esac
