> **Historical planning document.** Written before the experiments; some plans here were changed by the results. For how to reproduce the results, see `challenge-1-ml-decoder-kit/RUN.md` and `README.md`.

# Team plan: who does what, step by step

Five computers, one job each. p = 0.003 is the slowest job (rare failures need many shots), so it gets two computers. Agastya runs the analysis on any computer; it takes seconds.

| Computer | Job | Person also owns |
|---|---|---|
| **1** | p = 0.003, X basis | README |
| **2** | p = 0.003, Z basis | Plots for the slides |
| **3** | p = 0.004, X and Z, plus BP-OSD and the setup check (step 4) | Checking numbers make sense |
| **4** | p = 0.005, X and Z | Backup: reruns anything that crashed |
| **5** | Erasure experiment, X and Z | The erasure slide |
| **Agastya** | `analyze.py` on all results; go/no-go calls | Mentors, slides, pitch |

If a computer can't install relay-BP (step 2), give its job to the next-fastest computer.

---|---|---|
| **A** (fastest laptop) | p = 0.004 sweep + BP-OSD sanity check | Checking the setup is correct (step 4) |
| **B** | p = 0.003 sweep | README for the repo |
| **C** | p = 0.005 sweep | Plots in the slides |
| **D** | Erasure experiment | Explaining erasure on the slide |
| **Agastya** | Analysis (`analyze.py`), any laptop | Mentors, the go/no-go calls, slides, the pitch |

If someone's laptop can't install relay-BP (step 2 fails), they hand their job to Agastya's laptop and take over slides.

---

## Step 1. Get the code (everyone, 5 min)
```bash
git clone https://github.com/MGCquantum/MGCcorrection
cd MGCcorrection
```
If `lossy.py`, `run_job.py`, `analyze.py` and `RUN.md` aren't in `challenge-1-ml-decoder-kit/` yet, unzip `mgccorrection-code.zip` into this folder.

## Step 2. Install (everyone, 5–15 min)
```bash
cd challenge-1-ml-decoder-kit
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt scikit-learn matplotlib
```
- relay-BP needs Rust. If install fails on `relay-bp`, install Rust from https://rustup.rs, open a new terminal and repeat.
- Every new terminal needs `source .venv/bin/activate` first.

## Step 3. Quick check (everyone, 2 min)
```bash
mkdir -p results
python run_job.py --basis X --p 0.004 --shots 50 --seed 2 --decoders bp relay --out results/check.npz
```
It should print one line like `results/check.npz [20 s] bp: fails .. relay: fails ..`. Then delete `results/check.npz`. **Post "ready" in the group chat.**

## Step 4. Computer 3 confirms the setup is correct (15 min)
```bash
python baseline.py --p 0.004 --shots 1000
```
- relay-BP should fail about 1 in 100 pairs, which is roughly 10 failures.
- BP-OSD should fail about 5 in 100, which is roughly 50 failures.
- If these are far off, stop and tell Agastya.

## Step 5. Start your long job (computers 1-5)
Keep the computer plugged in with the lid open. On a Mac, put `caffeinate -i` in front of every command. Where it says "two terminals", run both at once.

**Computer 1 (p = 0.003, X):**
```bash
python run_job.py --basis X --p 0.003 --shots 5000 --seed 2 --decoders bp relay --out results/test_X_p0.003.npz
python run_job.py --basis X --p 0.003 --shots 5000 --seed 1 --decoders bp --out results/train_X_p0.003.npz
```
**Computer 2 (p = 0.003, Z):** the same two commands with `--basis Z` and `_Z_` in both file names.

**Computer 3 (p = 0.004), two terminals:**
```bash
# terminal 1
python run_job.py --basis X --p 0.004 --shots 2000 --seed 2 --decoders bp relay bposd --out results/test_X_p0.004.npz
python run_job.py --basis X --p 0.004 --shots 5000 --seed 1 --decoders bp --out results/train_X_p0.004.npz
# terminal 2
python run_job.py --basis Z --p 0.004 --shots 2000 --seed 2 --decoders bp relay bposd --out results/test_Z_p0.004.npz
python run_job.py --basis Z --p 0.004 --shots 5000 --seed 1 --decoders bp --out results/train_Z_p0.004.npz
```
**Computer 4 (p = 0.005), two terminals:**
```bash
# terminal 1
python run_job.py --basis X --p 0.005 --shots 2000 --seed 2 --decoders bp relay --out results/test_X_p0.005.npz
python run_job.py --basis X --p 0.005 --shots 5000 --seed 1 --decoders bp --out results/train_X_p0.005.npz
# terminal 2
python run_job.py --basis Z --p 0.005 --shots 2000 --seed 2 --decoders bp relay --out results/test_Z_p0.005.npz
python run_job.py --basis Z --p 0.005 --shots 5000 --seed 1 --decoders bp --out results/train_Z_p0.005.npz
```
**Computer 5 (erasure), two terminals:**
```bash
# terminal 1
for f in 0.25 0.5 0.75; do python run_job.py --basis X --p 0.004 --f $f --shots 1000 --seed 2 --decoders bposd bposd_flags --out results/erase_X_p0.004_f$f.npz; done
# terminal 2
for f in 0.25 0.5 0.75; do python run_job.py --basis Z --p 0.004 --f $f --shots 1000 --seed 2 --decoders bposd bposd_flags --out results/erase_Z_p0.004_f$f.npz; done
```

**Rules:**
- **Never change `--seed`:** 2 for test, 1 for train.
- **Copy file names exactly.** `analyze.py` finds files by name.
- When a command finishes, **paste its summary line** in the group chat.
- If a terminal shows an error, paste the last 5 lines in the chat. Don't try to fix it alone.

## Step 6. Hand over results (A–D)
Upload your `results/*.npz` files to the shared Drive folder, or push them:
```bash
git add -f results/*.npz && git commit -m "results: <your job>" && git push
```

## Step 7. Analysis (Agastya, any time, seconds)
Put every `.npz` file in one `results/` folder, then:
```bash
python analyze.py --dir results
```
You get a printed table, `results/results.csv` and `results/results.png`. Run it as soon as the first files arrive, so you can find problems early.

---

## Checkpoints (Agastya calls these)
| Time | Check | If it fails |
|---|---|---|
| 5:30 pm | Everyone posted "ready" (step 3) | Move that person's job to another laptop |
| 6:00 pm | Person A's setup check matches (step 4) | Stop everyone and fix it first |
| 8:00 pm | First erasure files are in, and `bposd_flags` fails less than `bposd` | Drop the erasure story and pitch the hybrid only |
| 11:00 pm | All jobs finished or running | Rerun anything missing overnight |
| 10:00 am Sun | Final `analyze.py` run; numbers locked | Use whatever is complete |
| 1:45 pm Sun | Code, results, plot and README pushed | — |

## If more time or laptops free up
- Rerun the test jobs with more shots (5,000 at p = 0.004 and 0.005) for tighter error bars. Use a new file name, keep the same seed, and replace the old file.
- Add more erasure points (`--f 0.1`, `0.9`).
