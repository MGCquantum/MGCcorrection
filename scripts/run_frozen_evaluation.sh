#!/usr/bin/env bash
# The frozen-test evaluation, end to end, in the order of the Makefile (train -> benchmark -> timing).
# Every step is one of the project's existing commands; this script only sequences them and records
# progress in experiments/pipeline_status.json, which the research lab reads to show
# pending / running / failed / completed. Collection steps resume from their checkpoints.
#
#   ./scripts/run_frozen_evaluation.sh            all steps
#   ./scripts/run_frozen_evaluation.sh --from S   start at step S (earlier steps are marked skipped)
#
# Local simulation only. Nothing here contacts quantum hardware or a cloud service.
set -uo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python
STATUS=experiments/pipeline_status.json

STEPS=(train test_records online evaluate timing evaluate_final figures report)
cmd() {
  case "$1" in
    train) echo "$PY -m aegis.train && $PY -m aegis.train --loss" ;;
    test_records) echo "./scripts/run_experiments.sh test" ;;
    online) echo "./scripts/run_final.sh online" ;;
    evaluate|evaluate_final) echo "$PY -m aegis.evaluate" ;;
    timing) echo "./scripts/run_final.sh timing" ;;
    figures) echo "$PY -m aegis.figures" ;;
    report) echo "$PY -m aegis.report" ;;
  esac
}

status() {  # status STEP STATE [EXIT_CODE]
  $PY - "$STATUS" "$1" "$2" "${3:-}" "${STEPS[@]}" <<'EOF'
import json, os, sys, time
path, step, state, code, steps = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:]
now = time.strftime("%Y-%m-%d %H:%M:%S")
try:
    data = json.load(open(path))
except Exception:
    data = {}
if step == "__init__":
    data = {"pipeline": "frozen-test evaluation", "started": now, "pid": os.getppid(),
            "steps": [{"name": s, "state": "pending"} for s in steps]}
for s in data.get("steps", []):
    if s["name"] == step:
        s["state"] = state
        s["started" if state == "running" else "finished"] = now
        if state == "running":
            s["load_average_at_start"] = [round(x, 2) for x in os.getloadavg()]
        if code:
            s["exit_code"] = int(code)
states = [s["state"] for s in data.get("steps", [])]
data["state"] = ("failed" if "failed" in states else "running" if "running" in states
                 else "completed" if states and all(x in ("done", "skipped") for x in states) else "pending")
data["updated"] = now
tmp = path + ".tmp"
json.dump(data, open(tmp, "w"), indent=1)
os.replace(tmp, path)
EOF
}

FROM="${2:-}"
[ "${1:-}" = "--from" ] || FROM=""
status __init__ pending
skipping=$([ -n "$FROM" ] && echo 1 || echo 0)
for step in "${STEPS[@]}"; do
  if [ "$skipping" = 1 ]; then
    if [ "$step" = "$FROM" ]; then skipping=0; else status "$step" skipped; continue; fi
  fi
  echo "=== $(date '+%H:%M:%S') step $step: $(cmd "$step")"
  status "$step" running
  bash -c "$(cmd "$step")"
  code=$?
  if [ $code -ne 0 ]; then
    status "$step" failed $code
    echo "=== step $step FAILED (exit $code)"
    exit $code
  fi
  status "$step" done 0
done
echo "=== $(date '+%H:%M:%S') frozen-test evaluation complete"
