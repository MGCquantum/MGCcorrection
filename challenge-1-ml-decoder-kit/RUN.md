# Reproduce and verify Challenge 1

Run from `challenge-1-ml-decoder-kit` using Python 3.12 or newer:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
bash scripts/verify_submission.sh
```

`requirements-local-lock.txt` records the exact packages used on the audit's
Python 3.13 macOS environment. Other platforms may need different wheels; relay-bp
may require Rust. The verifier runs tests, checks every required sweep row, writes
analysis/figures, and demonstrates fresh X and Z shots. It exits nonzero on failure.
The audit reports legacy cache limitations rather than inventing full fingerprints.

## Regenerate training and accuracy data

These commands create a separate directory, preserving the submitted caches.
All baselines are decoded together on each sampled shot; train uses seed 1, test
uses seed 2. Defaults below use four workers; choose fewer on a busy laptop.
On macOS, prefix the long commands with `caffeinate -i` and connect power.

```bash
mkdir -p results_reproduced
for p in 0.003 0.004 0.005; do
  n=2000; [ "$p" = 0.003 ] && n=5000
  for b in X Z; do
    .venv/bin/python run_job.py --basis "$b" --p "$p" --shots 5000 --seed 1 \
      --decoders bp --workers 4 --out "results_reproduced/train_${b}_p${p}.npz"
    .venv/bin/python run_job.py --basis "$b" --p "$p" --shots "$n" --seed 2 \
      --decoders bp relay bposd --workers 4 --out "results_reproduced/test_${b}_p${p}.npz"
  done
done
for f in 0 0.25 0.5 0.75; do
  n=2000; case "$f" in 0|0.25) n=1000;; esac
  for b in X Z; do
    .venv/bin/python run_job.py --basis "$b" --p 0.004 --f "$f" --shots "$n" --seed 2 \
      --decoders bposd bposd_flags --workers 4 --out "results_reproduced/erase_${b}_p0.004_f${f}.npz"
  done
done
for job in "0.004 32" "0.004 33" "0.005 31"; do
  set -- $job
  for b in X Z; do
    .venv/bin/python run_job.py --basis "$b" --p "$1" --f 0.5 --shots 10000 --seed "$2" \
      --decoders relay relay_flags --out "results_reproduced/erase4_${b}_p$1_f0.5_s$2.npz"
  done
done
.venv/bin/python analyze.py --dir results_reproduced
.venv/bin/python audit_submission.py --dir results_reproduced --out results_reproduced/audit.json
```

The archived sample's particular counts and broad sanity checks need not hold for
new independent samples. Inspect any failed scientific check; do not tune test
seeds or select a favorable rerun. Baseline reference values are statistical
comparisons, not target numbers to force.

## Latency and resources

```bash
caffeinate -i bash scripts/run_local_timing.sh
.venv/bin/python demo.py --p 0.004 --basis X
.venv/bin/python demo.py --p 0.004 --basis Z
```

The timing script uses 300 pairs per p, one worker, one numerical thread, and all
three decoders on the same shots. It writes `results_local_timing`; an intentional
rerun replaces that directory's outputs. Close competing workloads first for an
idle-machine benchmark. The audit's run had a separate experiment active, so its
latencies are labeled **under concurrent load**, not idle-laptop speedup evidence.
`results_timing` is the unchanged historical idle-laptop cache; it lacks BP-OSD.

Cached evaluation combines the measured decoder costs of the branches actually
chosen and measures router inference now. It is an estimate of deployed latency,
not an end-to-end service benchmark. Setup/training are excluded from decode time;
`demo.py` separately reports decoder setup, model size and whole-process peak RSS
(including training/imports). Accuracy counts reproduce; timings naturally vary.

Stim seeds are not portable across versions/builds or sample sizes. New cache
files include the full detector/observable SHA-256 and runtime provenance.
Old files retain only seeds, conditions, round weights and flag counts; those
compatibility checks are useful but are not a mathematical proof of identical shots.
Never append a partial decoder rerun to incompatible shots: rerun every decoder
for that basis together instead.
