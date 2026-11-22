#!/usr/bin/env bash
# The runs that need the trained model: the routed decoder online on the frozen test shots, and the
# single-worker latency benchmark. Run after `make train`, with nothing else running.
#
#   ./scripts/run_final.sh online     QEC-Aegis as one program on every test record
#   ./scripts/run_final.sh timing     latency benchmark: one worker, all decoders, separate shots (seed 5)
#   ./scripts/run_final.sh all
set -uo pipefail
cd "$(dirname "$0")/.."
C="caffeinate -i .venv/bin/python -u -m aegis.collect"
command -v caffeinate >/dev/null || C=".venv/bin/python -u -m aegis.collect"
M=models/aegis_router.joblib
ML=models/aegis_router_loss.joblib

online() {
  $C --split test --p 0.004 --shots 10000 --tiers aegis --model $M
  $C --split test --p 0.003 --shots 30000 --tiers aegis --model $M --chunk 100
  $C --split test --p 0.005 --shots 5000 --tiers aegis --model $M --chunk 25
  for f in 0.25 0.5 0.75; do
    $C --split test --p 0.004 --f $f --shots 5000 --tiers aegis+flags --model $ML
  done
}

timing() {
  # One worker, so a decode time is not shared with other decoding processes.
  $C --split timing --p 0.003 --shots 2000 --tiers bposd relay aegis --model $M --workers 1 --chunk 100
  $C --split timing --p 0.004 --shots 1000 --tiers bposd relay aegis --model $M --workers 1 --chunk 100
  $C --split timing --p 0.005 --shots 500 --tiers bposd relay aegis --model $M --workers 1 --chunk 50
}

case "${1:-all}" in
  online) online ;;
  timing) timing ;;
  all) online; timing ;;
  *) echo "usage: $0 [online|timing|all]" >&2; exit 1 ;;
esac
