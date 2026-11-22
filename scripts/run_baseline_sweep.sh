#!/usr/bin/env bash
# Reproduce the kit's baselines (BP-OSD and relay-BP) over the required sweep p = 0.003, 0.004, 0.005.
#
#   ./scripts/run_baseline_sweep.sh                 10,000 shots per basis, all three p (about 1.5 h on 8 cores)
#   SHOTS=1000 ./scripts/run_baseline_sweep.sh      quick version (about 5 min)
#   P="0.004" ./scripts/run_baseline_sweep.sh       one noise strength
#
# Logs go to results/baseline_logs/. Each log ends with wall time, CPU time and peak memory.
# Run it with nothing else on the machine: decode times are wall-clock times per shot.
set -euo pipefail
cd "$(dirname "$0")/../challenge-1-ml-decoder-kit"

SHOTS="${SHOTS:-10000}"
WORKERS="${WORKERS:-8}"
SEED="${SEED:-1}"
OUT=../results/baseline_logs
mkdir -p "$OUT"
KEEP_AWAKE=""; command -v caffeinate >/dev/null && KEEP_AWAKE="caffeinate -i"
for p in ${P:-0.003 0.004 0.005}; do
  log="$OUT/baseline_p${p}_${SHOTS}shots.log"
  echo "p=$p -> $log"
  { /usr/bin/time -l $KEEP_AWAKE ../.venv/bin/python baseline.py --p "$p" --shots "$SHOTS" --seed "$SEED" --workers "$WORKERS"; } > "$log" 2>&1 \
    || { /usr/bin/time -v ../.venv/bin/python baseline.py --p "$p" --shots "$SHOTS" --seed "$SEED" --workers "$WORKERS"; } > "$log" 2>&1
  head -3 "$log"
done
