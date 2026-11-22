# Copy-paste prompts, one per computer

Each person pastes their block into Claude (Claude Code on their laptop, or any Claude that can run commands), or runs the commands themselves.

## Computer 1
```text
You are running job "computer 1" for our hackathon decoder benchmark.
Clone https://github.com/MGCquantum/MGCcorrection and cd into challenge-1-ml-decoder-kit. Read ../SPEC.md for context only.
Setup: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt scikit-learn matplotlib (relay-bp needs Rust; install it from rustup.rs if the build fails). mkdir -p results.
Quick check: python run_job.py --basis X --p 0.004 --shots 50 --seed 2 --decoders bp relay --out results/check.npz ; it must print one summary line. Then delete results/check.npz and tell me it worked.
Rules: do NOT edit any code, seeds, shot counts or file names. On a Mac, prefix every long command with caffeinate -i. Run the two commands blocks below in two separate terminals at the same time where there are two. When each command finishes, show me its one summary line. If anything errors, show me the last 10 lines and stop; don't change code to fix it.
When everything has finished: git pull && git add -f results/*.npz && git commit -m "results: computer 1" && git push.
Commands (one terminal):
python run_job.py --basis X --p 0.003 --shots 5000 --seed 2 --decoders bp relay --out results/test_X_p0.003.npz
python run_job.py --basis X --p 0.003 --shots 5000 --seed 1 --decoders bp --out results/train_X_p0.003.npz
```

## Computer 2
```text
You are running job "computer 2" for our hackathon decoder benchmark.
Clone https://github.com/MGCquantum/MGCcorrection and cd into challenge-1-ml-decoder-kit. Read ../SPEC.md for context only.
Setup: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt scikit-learn matplotlib (relay-bp needs Rust; install it from rustup.rs if the build fails). mkdir -p results.
Quick check: python run_job.py --basis X --p 0.004 --shots 50 --seed 2 --decoders bp relay --out results/check.npz ; it must print one summary line. Then delete results/check.npz and tell me it worked.
Rules: do NOT edit any code, seeds, shot counts or file names. On a Mac, prefix every long command with caffeinate -i. Run the two commands blocks below in two separate terminals at the same time where there are two. When each command finishes, show me its one summary line. If anything errors, show me the last 10 lines and stop; don't change code to fix it.
When everything has finished: git pull && git add -f results/*.npz && git commit -m "results: computer 2" && git push.
Commands (one terminal):
python run_job.py --basis Z --p 0.003 --shots 5000 --seed 2 --decoders bp relay --out results/test_Z_p0.003.npz
python run_job.py --basis Z --p 0.003 --shots 5000 --seed 1 --decoders bp --out results/train_Z_p0.003.npz
```

## Computer 3
```text
You are running job "computer 3" for our hackathon decoder benchmark.
Clone https://github.com/MGCquantum/MGCcorrection and cd into challenge-1-ml-decoder-kit. Read ../SPEC.md for context only.
Setup: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt scikit-learn matplotlib (relay-bp needs Rust; install it from rustup.rs if the build fails). mkdir -p results.
Quick check: python run_job.py --basis X --p 0.004 --shots 50 --seed 2 --decoders bp relay --out results/check.npz ; it must print one summary line. Then delete results/check.npz and tell me it worked.
Rules: do NOT edit any code, seeds, shot counts or file names. On a Mac, prefix every long command with caffeinate -i. Run the two commands blocks below in two separate terminals at the same time where there are two. When each command finishes, show me its one summary line. If anything errors, show me the last 10 lines and stop; don't change code to fix it.
When everything has finished: git pull && git add -f results/*.npz && git commit -m "results: computer 3" && git push.
First, the setup check: python baseline.py --p 0.004 --shots 1000 . Expect relay-bp around 10 failures and bposd around 50 (per basis, roughly). Show me the output; if it is far off, stop.
Terminal 1:
python run_job.py --basis X --p 0.004 --shots 2000 --seed 2 --decoders bp relay bposd --out results/test_X_p0.004.npz
python run_job.py --basis X --p 0.004 --shots 5000 --seed 1 --decoders bp --out results/train_X_p0.004.npz
Terminal 2:
python run_job.py --basis Z --p 0.004 --shots 2000 --seed 2 --decoders bp relay bposd --out results/test_Z_p0.004.npz
python run_job.py --basis Z --p 0.004 --shots 5000 --seed 1 --decoders bp --out results/train_Z_p0.004.npz
```

## Computer 4
```text
You are running job "computer 4" for our hackathon decoder benchmark.
Clone https://github.com/MGCquantum/MGCcorrection and cd into challenge-1-ml-decoder-kit. Read ../SPEC.md for context only.
Setup: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt scikit-learn matplotlib (relay-bp needs Rust; install it from rustup.rs if the build fails). mkdir -p results.
Quick check: python run_job.py --basis X --p 0.004 --shots 50 --seed 2 --decoders bp relay --out results/check.npz ; it must print one summary line. Then delete results/check.npz and tell me it worked.
Rules: do NOT edit any code, seeds, shot counts or file names. On a Mac, prefix every long command with caffeinate -i. Run the two commands blocks below in two separate terminals at the same time where there are two. When each command finishes, show me its one summary line. If anything errors, show me the last 10 lines and stop; don't change code to fix it.
When everything has finished: git pull && git add -f results/*.npz && git commit -m "results: computer 4" && git push.
Terminal 1:
python run_job.py --basis X --p 0.005 --shots 2000 --seed 2 --decoders bp relay --out results/test_X_p0.005.npz
python run_job.py --basis X --p 0.005 --shots 5000 --seed 1 --decoders bp --out results/train_X_p0.005.npz
Terminal 2:
python run_job.py --basis Z --p 0.005 --shots 2000 --seed 2 --decoders bp relay --out results/test_Z_p0.005.npz
python run_job.py --basis Z --p 0.005 --shots 5000 --seed 1 --decoders bp --out results/train_Z_p0.005.npz
```

## Computer 5
```text
You are running job "computer 5" for our hackathon decoder benchmark.
Clone https://github.com/MGCquantum/MGCcorrection and cd into challenge-1-ml-decoder-kit. Read ../SPEC.md for context only.
Setup: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt scikit-learn matplotlib (relay-bp needs Rust; install it from rustup.rs if the build fails). mkdir -p results.
Quick check: python run_job.py --basis X --p 0.004 --shots 50 --seed 2 --decoders bp relay --out results/check.npz ; it must print one summary line. Then delete results/check.npz and tell me it worked.
Rules: do NOT edit any code, seeds, shot counts or file names. On a Mac, prefix every long command with caffeinate -i. Run the two commands blocks below in two separate terminals at the same time where there are two. When each command finishes, show me its one summary line. If anything errors, show me the last 10 lines and stop; don't change code to fix it.
When everything has finished: git pull && git add -f results/*.npz && git commit -m "results: computer 5" && git push.
Terminal 1:
for f in 0.25 0.5 0.75; do python run_job.py --basis X --p 0.004 --f $f --shots 1000 --seed 2 --decoders bposd bposd_flags --out results/erase_X_p0.004_f$f.npz; done
Terminal 2:
for f in 0.25 0.5 0.75; do python run_job.py --basis Z --p 0.004 --f $f --shots 1000 --seed 2 --decoders bposd bposd_flags --out results/erase_Z_p0.004_f$f.npz; done
```

## Agastya (analysis, any computer, any time)
```text
Clone https://github.com/MGCquantum/MGCcorrection, cd challenge-1-ml-decoder-kit, set up the venv as in TEAM_PLAN.md step 2.
Then: git pull && python analyze.py --dir results
Show me the printed table and open results/results.png. Do not edit code. Compare the numbers against the targets in ../SPEC.md ("What working means") and tell me which targets pass and which fail.
```

## Erasure rerun (corrected model). Computers 4 and 5, as soon as they're free
The first erasure run used a prior that was too low and a noise model that added extra noise. Both are fixed. The old files were moved to `results_old_erasure_model/` and are not used.

**Computer 5:**
```text
cd into MGCcorrection/challenge-1-ml-decoder-kit, run git pull, then source .venv/bin/activate. Do not edit code.
Run these two blocks in two terminals at the same time (caffeinate -i on a Mac); show me each summary line:
Terminal 1: for f in 0 0.25; do python run_job.py --basis X --p 0.004 --f $f --shots 1000 --seed 2 --decoders bposd bposd_flags --out results/erase_X_p0.004_f$f.npz; done
Terminal 2: for f in 0 0.25; do python run_job.py --basis Z --p 0.004 --f $f --shots 1000 --seed 2 --decoders bposd bposd_flags --out results/erase_Z_p0.004_f$f.npz; done
When both finish: git pull && git add -f results/erase_*.npz && git commit -m "results: erasure rerun, computer 5" && git push
```
**Computer 4:**
```text
cd into MGCcorrection/challenge-1-ml-decoder-kit, run git pull, then source .venv/bin/activate. Do not edit code.
Run these two blocks in two terminals at the same time (caffeinate -i on a Mac); show me each summary line:
Terminal 1: for f in 0.5 0.75; do python run_job.py --basis X --p 0.004 --f $f --shots 2000 --seed 2 --decoders bposd bposd_flags --out results/erase_X_p0.004_f$f.npz; done
Terminal 2: for f in 0.5 0.75; do python run_job.py --basis Z --p 0.004 --f $f --shots 2000 --seed 2 --decoders bposd bposd_flags --out results/erase_Z_p0.004_f$f.npz; done
When both finish: git pull && git add -f results/erase_*.npz && git commit -m "results: erasure rerun, computer 4" && git push
```

## Clean timing run: one computer, nothing else running (Sunday morning, or tonight once a laptop is idle)
The overnight jobs ran several decoders and terminals at once, so their **timings** are distorted. Their **error rates** are fine. This run measures speed fairly.
```text
cd into MGCcorrection/challenge-1-ml-decoder-kit, git pull, source .venv/bin/activate. Close every other app. Do not edit code.
Run in ONE terminal, one command at a time (caffeinate -i on a Mac):
for p in 0.003 0.004 0.005; do for b in X Z; do python run_job.py --basis $b --p $p --shots 300 --seed 2 --workers 1 --decoders bp relay --out results_timing/test_${b}_p$p.npz; done; done
Then: python analyze.py --dir results_timing   (use only its mean/p99 times; its error rates are too noisy with 300 shots)
git pull && git add -f results_timing/*.npz && git commit -m "results: clean timing" && git push
```
