# MGC: erasure-aware decoding of the Gross code

Infleqtion Challenge 1 (ML-assisted QEC decoding), MidQWest 2026. See [AUDIT.md](AUDIT.md) for the submission readiness checks. The challenge brief is in [CHALLENGE.md](CHALLENGE.md).

**Question:** on neutral-atom hardware, some errors can be converted into *erasures* that come with a flag saying where they happened (idealized heralded erasure conversion; real atom loss is detected later, see limits). How much does a decoder gain on the [[144,12,12]] Gross code by using those flags, and can ML cut decoding time without losing accuracy?

## Results

### 1. Using erasure flags (headline)
**relay-BP, the strongest decoder in the kit, with the loss flags.** relay-BP has no per-shot prior update, so it is rebuilt for every shot (about 17 ms, included in its time) on the flag-blind matrix, with each flagged location's error probability raised (`lossy.fold_priors`, combining identical effects by parity). 50% of gate/idle noise flagged as erasure; the same shots are decoded with flags ignored and with flags used.

| p | Pairs | Flags ignored: failed pairs (rate/cycle) | Flags used | Failed only ignored / only used | Exact McNemar p | Mean time ignored → used | p99 latency ignored → used |
|---|---|---|---|---|---|---|---|
| 0.004 | 20,000 | 36 (1.5e-4) | **3** (1.3e-5) | 33 / 0 | 2e-10 | 179 → **78 ms** | 1,726 → **265 ms** |
| 0.005 | 10,000 | 140 (1.2e-3) | **9** (7.5e-5) | 134 / 3 | 5e-36 | 544 → **109 ms** | 7,521 → **650 ms** |

12–16× fewer failed pairs, 2–5× faster on average and 6–12× lower p99 latency. With only 3 and 9 failures when flags are used, read the accuracy gain as "about an order of magnitude", not as a precise ratio. Timing was measured on one Apple laptop, 11 worker processes, both decoders on the same shots under the same load; read it as a ratio, not a latency guarantee. Seeds 32 and 33 (p = 0.004) and 31 (p = 0.005); files `results_v2/erase4_*`. Every shot is used: X and Z come from independent random streams (see *Pairing* below).

![relay flags](challenge-1-ml-decoder-kit/figures/relay_flags.png)

**BP-OSD with the loss flags** (the first experiment; the flags enter BP-OSD's priors through its per-shot update):
These results include the corrected herald-conditioned prior calculation (see [AUDIT.md](AUDIT.md)); the erasure runs were regenerated locally after the fix.
p = 0.004, 12 syndrome cycles, X and Z memory. The same simulated shots are decoded with flags hidden and with flags visible. Rates are logical errors per cycle with exact (Clopper-Pearson) 95% intervals.

| Noise flagged as erasure | Flags hidden (BP-OSD) | Flags used (BP-OSD) | Pairs |
|---|---|---|---|
| 0% | 4.4e-3 [3.3–5.8e-3] (52) | 4.4e-3 (identical, as expected) | 1,000 |
| 25% | 1.3e-3 [0.8–2.2e-3] (16) | 6.7e-4 [2.9–13e-4] (8) | 1,000 |
| 50% | 9.6e-4 [6.1–14e-4] (23) | 1.3e-4 [0.3–3.7e-4] (3) | 2,000 |
| 75% | 4.6e-4 [2.3–8.2e-4] (11) | < 1.5e-4 (0 failures seen) | 2,000 |

**Paired test on identical shots** (pairs where only one of the two decoders failed; exact McNemar test):

| Noise flagged | Failed only with flags hidden | Failed only with flags used | p-value |
|---|---|---|---|
| 25% | 11 | 3 | 0.057 (not significant) |
| 50% | 21 | 1 | 1.1e-5 |
| 75% | 11 | 0 | 0.001 |

For BP-OSD, fewer pairs failed with flags at every nonzero share. The gain is significant at 50% and 75% and borderline at 25% (p = 0.057); with 0–8 flag-aware failures its size is poorly determined. The relay-BP experiment above, with 5–20× more pairs, is the strongest evidence that flags help.

**Scope:** this table is BP-OSD only; the relay-BP result above uses a different flag mechanism (rebuild per shot on the blind matrix) and needs no extra columns. The 0% row (4.4e-3 on 1,000 pairs) and the sweep's BP-OSD at p = 0.004 (4.1e-3 on 2,000 different pairs) agree.

![erasure](challenge-1-ml-decoder-kit/figures/erasure.png)

- **Cost:** flag-aware BP-OSD is about 5.5× slower per shot at 50% erasure (about 7.4× at 25% and 7.3× at 75%, all measured on the same shots under the same 11-worker load), because the decoder considers each erasure component separately and its priors are updated every shot.
- **Why the flag-blind line also falls:** an erasure applies a random Pauli, and a quarter of those are the identity, so converting noise to erasure also lowers the effective error rate. The fair comparison is therefore flags hidden vs used **at the same erasure share, on the same shots**.

### 2. Required sweep: baselines and hybrid decoders
Logical error rate per cycle (95% CI) and failed pairs, same test shots for every decoder:

*Pairing:* the current evidence (`results_v2`) was generated with independent X and Z random streams: `run_job.py` (seed scheme `ss-v1`) derives each Stim seed from the root seed, split (train/test), basis, p and f with numpy `SeedSequence`. X row k and Z row k are therefore independent, every shot is used, and the exact intervals and McNemar tests apply. The legacy caches in `results/` reused one stream for X and Z; `analyze.independent_pairs` analyses them by taking X and Z shots from disjoint halves of the indices (a shuffle alone would leave dependent pairs), which halves their sample. Comparing the two, 23 of 24 matching rows show no significant difference (Fisher exact p > 0.05); the exception, BP-OSD at p = 0.003 (7/2,500 legacy vs 33/5,000 new, p = 0.04), is about what 24 tests give by chance, and the new value is the one closer to the kit reference. See [results/README.md](challenge-1-ml-decoder-kit/results/README.md).

| p | relay-BP | BP-OSD | Hybrid (rule) | Hybrid (ML router) | Kit reference (relay / BP-OSD) |
|---|---|---|---|---|---|
| 0.003 | 8.3e-5 (5/5,000) | 5.5e-4 (33/5,000) | 8.3e-5 (5/5,000) | 8.3e-5 (5/5,000) | 4.2e-5 / 4.7e-4 |
| 0.004 | 7.9e-4 (19/2,000) | 4.1e-3 (96/2,000) | 7.9e-4 (19/2,000) | 7.9e-4 (19/2,000) | 8.7e-4 / 4.4e-3 |
| 0.005 | 7.2e-3 (167/2,000) | 2.2e-2 (473/2,000) | 7.2e-3 (166/2,000) | 7.2e-3 (166/2,000) | 6.9e-3 / 2.3e-2 |

Every kit reference lies inside our 95% interval. Both hybrids match relay-BP's failed-pair count at p = 0.003 and 0.004 and have one fewer at p = 0.005 (a shot where fast BP's converged answer was right and relay-BP's was not); equal or near-equal counts on a finite sample do not prove equal underlying error rates, and the audit checks only that the hybrid is not significantly worse. The hybrid is close to relay-BP with an early exit: relay-BP's first leg is BP, and the kit keeps running relay legs until 5 solutions have been found (`stop_nconv=5`) and returns the best of them, while the hybrid accepts BP's first converged answer.

**Decode time** (historical timing caches with the legacy seed scheme; one idle laptop, 1 thread, 150 independent X+Z pairs per p):

| p | relay-BP mean / p99 | Hybrid (rule) mean / p99 | Hybrid (ML) mean | Shots escalated (rule) |
|---|---|---|---|---|
| 0.003 | 92 / 366 ms | **55** / 393 ms | 57 ms | 5% |
| 0.004 | 557 / 7,303 ms | 475 / 7,263 ms | 474 ms | 23% |
| 0.005 | 2,086 / 10,276 ms | 2,081 / 10,425 ms | 2,092 ms | 56% |

![speed](challenge-1-ml-decoder-kit/figures/speed.png)


**Additional local comparison with both baselines:** Apple M5 (a teammate's laptop), 150 independent pairs per p, one worker/thread, under concurrent load. Entries are mean / p99 milliseconds per X+Z pair. Every decoder uses the same shots within this run. These are measured comparisons, not idle-machine latency guarantees.

| p | BP-OSD | relay-BP | Hybrid rule | Hybrid ML |
|---|---:|---:|---:|---:|
| 0.003 | 100 / 543 | 67 / 618 | 48 / 651 | 48 / 652 |
| 0.004 | 298 / 830 | 245 / 3171 | 229 / 3210 | 232 / 3211 |
| 0.005 | 503 / 966 | 1264 / 8263 | 1252 / 8377 | 1256 / 8265 |

![local speed comparison](challenge-1-ml-decoder-kit/figures/speed_local.png)

### 3. The ML router (an honest negative result)
A gradient-boosted classifier reads the alarms per round and predicts whether fast BP will converge, so hard shots can skip it. (It also has a loss-flag-count input, but the sweep has no erasure, so that input is always 0.) Accuracy on held-out shots:

| p | ML router | One alarm-count threshold | Always guess the majority |
|---|---|---|---|
| 0.003 | 0.916 | 0.917 | 0.917 |
| 0.004 | 0.740 | 0.751 | 0.749 |
| 0.005 | 0.604 | 0.618 | 0.515 |

The router does not beat a single threshold. BP's own convergence check is already a good router: across all 14,089 test shots where fast BP converged, it was never wrong (2 of 14,166 in the legacy caches, both at p = 0.005).

**Upper bound for any router** (from the clean timing cache): even a *perfect* router, which skips BP exactly on the shots where it won't converge, would cut the hybrid's mean time by only 16.5% at p = 0.003, 7.8% at p = 0.004 and 3.7% at p = 0.005. Routing on convergence has little to gain. Learning would be better spent elsewhere, for example on per-shot priors.

## Where it works and where it falls short
- **Works:** with relay-BP, using erasure flags gives a large, statistically significant accuracy gain (p ≤ 2e-10 at both noise levels) and makes decoding 2–5× faster on average with 6–12× lower p99 latency. With BP-OSD the flags also reduce failures; the gain is significant at 50% and 75% flagged and borderline at 25%. The simple convergence hybrid keeps relay-BP accuracy and is ~1.7× faster on average at low noise (p = 0.003).
- **Falls short:**
  - Convergence hybrid: p99 latency does not improve, and there is no speedup at p = 0.005. (Both refer to the hybrid, not to flag-aware relay-BP, which is faster on both counts.)
  - Flag-aware *BP-OSD* costs several times more decode time than flag-blind BP-OSD (flag-aware relay-BP is faster, not slower).
  - The ML router does not outperform the simple convergence rule.
  - Error bars are wide wherever failures are few: p = 0.003 (5 relay-BP failures), the BP-OSD erasure table, and the flag-aware relay counts (3 and 9).
- **Model limits:** erasures are *idealized*. Flags fire instantly at the gate with the exact location, and the qubit returns to the code space. Real atom loss is detected later and a lost atom keeps causing errors. Preparation and measurement errors are not converted. The DEM/decoder also approximates correlations between disjoint Pauli outcomes; corrected conditional marginals do not make it an exact joint decoder.

## Method
- **Code and noise:** the kit's Gross-code memory circuits (Bravyi et al.; the relay-BP paper's error model). In `lossy.py`, each depolarizing channel of strength p becomes `DEPOLARIZE((1−f)p)` plus `HERALDED_ERASE`, with probability f·p per qubit for one-qubit channels and f·p/2 per qubit for two-qubit channels, so the expected number of fault events per gate stays about p. Each herald is recorded as a detector (coordinate 2).
- **Flag-aware priors:** erasure components keep their own decoder columns. Pauli multiplicities are recovered from the DEM probability divided by the herald-event probability, including outcomes Stim has already merged. Mutually exclusive outcomes sharing a herald are summed. Per shot, a column whose herald fired gets prior (merged Pauli components) × 1/4, e.g. 0.5 when two components look identical to the checks. Unfired erasure columns get 1e-9. The prior update is counted as decode time.
- **Hybrid:** min-sum BP (200 iterations). If it converges, its answer is accepted. Otherwise relay-BP runs, at the kit's settings.
- **Router:** scikit-learn `HistGradientBoostingClassifier`, trained on seed-1 shots and tested on seed-2 shots.
- **Scoring:** the kit's rule. An X/Z shot pair fails if either basis fails, and per-cycle rate = 1 − (1 − P)^(1/12).

## Resources
From the audited local `python demo.py` runs on an Apple M4 Pro (12 logical cores, numerical libraries limited to one thread):
- Decoding problem: 936 checks × 8,784 error mechanisms.
- Router model: 718 kB.
- Peak memory: 237–240 MB for the whole demo process, including imports and router training (191–196 MB on the teammate's Apple M5 in earlier runs).
- Decoder setup: ~0.02 s. Both fresh X/Z seed-99 demos decoded correctly. The demo is a demonstration, not a pass/fail check (a correct decoder can fail on a noisy shot); the asserted live checks are the real fast-BP, relay-BP and fallback tests in `test_submission.py`.

The flag-aware matrix is larger (936 × ~32,000 columns). The `results_v2` caches were generated with 11 worker processes on one Apple M4 Pro (12 logical cores); the legacy caches used 7–8 workers on 8–12-core laptops. The historical timing table used 1 thread and lacks BP-OSD. The new local timing sweep includes BP-OSD, relay-BP and both hybrids on matching shots; it is explicitly labeled as a concurrent-load run.

## Reproduce
```bash
cd challenge-1-ml-decoder-kit
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt      # relay-bp needs Rust (rustup.rs)
python run_job.py --basis X --p 0.004 --shots 2000 --seed 2 --decoders bp relay bposd --out results_new/test_X_p0.004.npz   # independent X/Z streams (seed scheme ss-v1)
# Full fresh-data commands are in challenge-1-ml-decoder-kit/RUN.md
bash scripts/verify_submission.sh                            # tests, audit, evaluation, demos
python analyze.py --dir results_v2                            # tables and results_v2/results.png (all experiments)
python analyze.py --dir results_timing --train-dir results    # historical timing table (legacy caches)
python make_figures.py                                        # figures/erasure.png, relay_flags.png, speed.png
python demo.py --p 0.004 --basis X                            # one fresh shot through router and decoder, plus resources
```
- Saved result caches are in the repo. `analyze.py` reproduces accuracy counts without rerunning the decoders; router timings are newly measured and naturally vary. See [RUN.md](challenge-1-ml-decoder-kit/RUN.md) for full regeneration commands and package versions.
- **Seeds are not portable across Stim builds:** the same seed can give different shots on another machine. That is why every comparison is made within one results file (all decoders on identical shots), and why `analyze.py` checks metadata, per-round weights and flags before merging extras. Legacy caches lack full sample fingerprints, so this compatibility check is not a proof of shot identity. New runs also record a detector/observable SHA-256, the circuit SHA-256, split, seed scheme, derived sampler seed and runtime provenance.

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
| `results_v2/`, `results/` | Current independent-stream caches and evaluation; legacy same-stream caches kept as history |
| `docs/history/` | Historical planning notes and agent prompts; superseded by the audit |
