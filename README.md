# MGC: erasure-aware decoding of the Gross code

Infleqtion Challenge 1 (ML-assisted QEC decoding), MidQWest 2026. See [AUDIT.md](AUDIT.md) for the submission readiness checks. The challenge brief is in [CHALLENGE.md](CHALLENGE.md).

**Question:** on neutral-atom hardware, some errors can be converted into *erasures* that come with a flag saying where they happened (idealized heralded erasure conversion; real atom loss is detected later, see limits). How much does a decoder gain on the [[144,12,12]] Gross code by using those flags, and can ML cut decoding time without losing accuracy?

## Results

### 1. Using erasure flags (headline)
These results include the corrected herald-conditioned prior calculation (see [AUDIT.md](AUDIT.md)); the erasure runs were regenerated locally after the fix.
p = 0.004, 12 syndrome cycles, X and Z memory. The same simulated shots are decoded with flags hidden and with flags visible. Rates are logical errors per cycle with exact (Clopper-Pearson) 95% intervals.

| Noise flagged as erasure | Flags hidden (BP-OSD) | Flags used (BP-OSD) | Gain | Pairs |
|---|---|---|---|---|
| 0% | 4.3e-3 [3.2–5.6e-3] | 4.3e-3 (identical, as expected) | — | 1,000 |
| 25% | 1.4e-3 [0.8–2.3e-3] | 6.7e-4 [2.9–13e-4] | ~2× | 1,000 |
| 50% | 9.2e-4 [5.8–14e-4] | 1.3e-4 [0.3–3.7e-4] | **~7.3×** | 2,000 |
| 75% | 4.2e-4 [2.0–7.7e-4] | < 1.5e-4 (0 failures seen) | no failures to count | 2,000 |

**Paired test on identical shots** (pairs where only one of the two decoders failed; exact McNemar test):

| Noise flagged | Failed only with flags hidden | Failed only with flags used | p-value |
|---|---|---|---|
| 25% | 15 | 6 | 0.078 (not significant) |
| 50% | 19 | 0 | 3.8e-6 |
| 75% | 10 | 0 | 0.002 |

At 50%, 22 pairs failed with flags hidden versus 3 with flags used. Using the flags never caused a failure that the flag-blind decoder avoided. The "~7.3×" is the ratio of those counts, and its uncertainty is wide (the 95% intervals in the table above), so read it as "several times fewer".

**Scope:** the flags were tested with BP-OSD, the decoder whose priors can be updated per shot. relay-BP is about 7× more accurate than BP-OSD at p = 0.004 without erasure, and it was not run with flags (its API has no per-shot prior update). The 0% row (4.3e-3 on 1,000 pairs) and the sweep's BP-OSD at p = 0.004 (4.1e-3 on 2,000 different pairs) agree within their intervals.

![erasure](challenge-1-ml-decoder-kit/figures/erasure.png)

- **Cost:** flag-aware BP-OSD is about 6.5× slower per shot at 50% erasure (about 9–10× at 25% and 75%), because the decoder considers each erasure component separately and its priors are updated every shot.
- **Why the flag-blind line also falls:** an erasure applies a random Pauli, and a quarter of those are the identity, so converting noise to erasure also lowers the effective error rate. The fair comparison is therefore flags hidden vs used **at the same erasure share, on the same shots**.

### 2. Required sweep: baselines and hybrid decoders
Logical error rate per cycle (95% CI) and failed pairs, same test shots for every decoder:

| p | relay-BP | BP-OSD | Hybrid (rule) | Hybrid (ML router) | Kit reference (relay / BP-OSD) |
|---|---|---|---|---|---|
| 0.003 | 3.3e-5 (2/5,000) | 3.3e-4 (20/5,000) | 3.3e-5 (2/5,000) | 3.3e-5 (2/5,000) | 4.2e-5 / 4.7e-4 |
| 0.004 | 6.3e-4 (15/2,000) | 4.1e-3 (97/2,000) | 6.3e-4 (15/2,000) | 6.3e-4 (15/2,000) | 8.7e-4 / 4.4e-3 |
| 0.005 | 6.3e-3 (145/2,000) | 2.2e-2 (469/2,000) | 6.3e-3 (145/2,000) | 6.3e-3 (145/2,000) | 6.9e-3 / 2.3e-2 |

Both hybrids have the same observed failed-pair count as relay-BP at all three tested noise levels; this finite sample does not prove equal underlying error rates. The hybrid is close to relay-BP with an early exit: relay-BP's first leg is BP, and the kit runs it until 5 solutions agree (`stop_nconv=5`), while the hybrid accepts BP's first converged answer.

**Decode time** (one idle laptop, 1 thread, 300 X+Z pairs per p):

| p | relay-BP mean / slowest 1% | Hybrid (rule) mean / slowest 1% | Hybrid (ML) mean | Shots escalated (rule) |
|---|---|---|---|---|
| 0.003 | 97 / 672 ms | **58** / 713 ms | 62 ms | 5% |
| 0.004 | 482 / 7,054 ms | 422 / 7,099 ms | 427 ms | 23% |
| 0.005 | 2,155 / 13,455 ms | 2,165 / 13,590 ms | 2,164 ms | 56% |

![speed](challenge-1-ml-decoder-kit/figures/speed.png)


**Additional local comparison with both baselines:** Apple M5, 300 pairs per p, one worker/thread, under concurrent load. Entries are mean / p99 milliseconds per X+Z pair. Every decoder uses the same shots within this run. These are measured comparisons, not idle-machine latency guarantees.

| p | BP-OSD | relay-BP | Hybrid rule | Hybrid ML |
|---|---:|---:|---:|---:|
| 0.003 | 97 / 570 | 62 / 324 | 41 / 369 | 43 / 370 |
| 0.004 | 285 / 832 | 217 / 2700 | 200 / 2793 | 203 / 2795 |
| 0.005 | 503 / 991 | 1259 / 8414 | 1253 / 8523 | 1254 / 8415 |

![local speed comparison](challenge-1-ml-decoder-kit/figures/speed_local.png)

### 3. The ML router (an honest negative result)
A gradient-boosted classifier reads the alarms per round and predicts whether fast BP will converge, so hard shots can skip it. (It also has a loss-flag-count input, but the sweep has no erasure, so that input is always 0.) Accuracy on held-out shots:

| p | ML router | One alarm-count threshold | Always guess the majority |
|---|---|---|---|
| 0.003 | 0.929 | 0.929 | 0.929 |
| 0.004 | 0.757 | 0.773 | 0.775 |
| 0.005 | 0.597 | 0.614 | 0.530 |

The router does not beat a single threshold. BP's own convergence check is already a good router: across all 14,166 test shots where fast BP converged, it was wrong on only 2 (both at p = 0.005).

**Upper bound for any router** (from the clean timing cache): even a *perfect* router, which skips BP exactly on the shots where it won't converge, would cut the hybrid's mean time by only 16.5% at p = 0.003, 7.8% at p = 0.004 and 3.7% at p = 0.005. Routing on convergence has little to gain. Learning would be better spent elsewhere, for example on per-shot priors.

## Where it works and where it falls short
- **Works:** using erasure flags gives large, statistically significant accuracy gains on the Gross code (BP-OSD). The simple hybrid keeps relay-BP accuracy and is ~1.7× faster on average at low noise (p = 0.003).
- **Falls short:**
  - The slowest 1% of shots do not get faster.
  - There is no speedup at p = 0.005.
  - Flag-aware decoding costs about 6.5× more time at 50% erasure.
  - The ML router does not outperform the simple convergence rule.
  - Error bars at p = 0.003 are wide, with only 2–3 failures.
- **Model limits:** erasures are *idealized*. Flags fire instantly at the gate with the exact location, and the qubit returns to the code space. Real atom loss is detected later and a lost atom keeps causing errors. Preparation and measurement errors are not converted. The DEM/decoder also approximates correlations between disjoint Pauli outcomes; corrected conditional marginals do not make it an exact joint decoder.

## Method
- **Code and noise:** the kit's Gross-code memory circuits (Bravyi et al.; the relay-BP paper's error model). In `lossy.py`, each depolarizing channel of strength p becomes `DEPOLARIZE((1−f)p)` plus `HERALDED_ERASE`, with probability f·p per qubit for one-qubit channels and f·p/2 per qubit for two-qubit channels, so the expected number of fault events per gate stays about p. Each herald is recorded as a detector (coordinate 2).
- **Flag-aware priors:** erasure components keep their own decoder columns. Pauli multiplicities are recovered from the DEM probability divided by the herald-event probability, including outcomes Stim has already merged. Mutually exclusive outcomes sharing a herald are summed. Per shot, a column whose herald fired gets prior (merged Pauli components) × 1/4, e.g. 0.5 when two components look identical to the checks. Unfired erasure columns get 1e-9. The prior update is counted as decode time.
- **Hybrid:** min-sum BP (200 iterations). If it converges, its answer is accepted. Otherwise relay-BP runs, at the kit's settings.
- **Router:** scikit-learn `HistGradientBoostingClassifier`, trained on seed-1 shots and tested on seed-2 shots.
- **Scoring:** the kit's rule. An X/Z shot pair fails if either basis fails, and per-cycle rate = 1 − (1 − P)^(1/12).

## Resources
From the audited local `python demo.py` runs on an Apple M5 (10 logical cores, numerical libraries limited to one thread):
- Decoding problem: 936 checks × 8,784 error mechanisms.
- Router model: 718 kB.
- Peak memory: 191–196 MB for the whole demo process, including imports and router training.
- Decoder setup: ~0.02–0.03 s. Both fresh X/Z seed-99 demos decoded correctly; a demo is a functional check, not an accuracy benchmark.

The flag-aware matrix is larger (936 × ~32,000 columns). Benchmarks used 7–8 worker processes per laptop on 8–12-core laptops. The historical timing table used 1 thread and lacks BP-OSD. The new local timing sweep includes BP-OSD, relay-BP and both hybrids on matching shots; it is explicitly labeled as a concurrent-load run.

## Reproduce
```bash
cd challenge-1-ml-decoder-kit
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt      # relay-bp needs Rust (rustup.rs)
python run_job.py --basis X --p 0.004 --shots 2000 --seed 2 --decoders bp relay bposd --out results/test_X_p0.004.npz
# Full fresh-data commands are in challenge-1-ml-decoder-kit/RUN.md
bash scripts/verify_submission.sh                            # tests, audit, evaluation, demos
python analyze.py --dir results                               # tables and results/results.png
python analyze.py --dir results_timing --train-dir results    # clean timing table
python make_figures.py                                        # figures/erasure.png, figures/speed.png
python demo.py --p 0.004 --basis X                            # one fresh shot through router and decoder, plus resources
```
- Saved result caches are in the repo. `analyze.py` reproduces accuracy counts without rerunning the decoders; router timings are newly measured and naturally vary. See [RUN.md](challenge-1-ml-decoder-kit/RUN.md) for full regeneration commands and package versions.
- **Seeds are not portable across Stim builds:** the same seed can give different shots on another machine. That is why every comparison is made within one results file (all decoders on identical shots), and why `analyze.py` checks metadata, per-round weights and flags before merging extras. Legacy caches lack full sample fingerprints, so this compatibility check is not a proof of shot identity. New runs also record a detector/observable SHA-256 and runtime provenance.

## Files
| File | What it does |
|---|---|
| `lossy.py` | Heralded-erasure circuits; flag-blind and flag-aware decoding matrices; per-shot priors |
| `run_job.py` | Decodes a batch of shots once with the chosen decoders and caches every answer, time and convergence flag |
| `analyze.py` | Trains the router, builds the hybrids from the cache, reports exact CIs, writes tables and plots |
| `make_figures.py` | Presentation figures |
| `demo.py`, `hybrid.py` | Shared trained router and live decoding interface; resource report |
| `audit_submission.py`, `scripts/verify_submission.sh` | Repeatable data checks, tests, evaluation and live demos |
| `AUDIT.md`, `PITCH.md`, `challenge-1-ml-decoder-kit/RUN.md` | Current evidence, presentation, and reproduction guide |
| `SPEC.md`, `TEAM_PLAN.md`, `PROMPTS.md` | Historical planning notes; superseded by the audit |
