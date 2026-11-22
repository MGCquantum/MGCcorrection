# QEC-Aegis: learned risk routing for fast, accurate Gross-code decoding

**Infleqtion Challenge 1: ML-assisted QEC decoding** · MidQWest 2026 · [Challenge brief](CHALLENGE.md)

QEC-Aegis decodes the [[144,12,12]] Gross code with a fast decoder on every shot and a machine-learned risk model that sends only doubtful shots to the slow, accurate decoder. On fresh test data it is **1.5–4.5× faster than relay-BP on average with no significant loss of accuracy**, and at p = 0.005 it is **significantly more accurate** than relay-BP.

## Start here
| Step | Read | Time |
|---|---|---|
| 1 | [The idea](#the-idea) | 30 s |
| 2 | [Results](#results) | 1 min |
| 3 | [`aegis/decoder.py`](aegis/decoder.py): the whole decoder in 69 lines | 2 min |
| 4 | [Quickstart](#quickstart): run the live demo | 2 min |
| 5 | [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md): first principles, then a tour of the code | 10 min |

## The idea
- **Most shots are easy:** a short relay-BP run converges to the right correction.
- **The costly mistake is hidden:** on rare shots the fast run **converges to a wrong answer**, and no convergence check can see it.
- **What QEC-Aegis does:** it reads 28 features of the fast run and predicts a **calibrated probability that the answer is wrong**. Only shots above a threshold, chosen on validation data, go to full relay-BP.

```
syndrome ─► tier 1: fast relay-BP ─► 28 features ─► risk model ─┬─► accept the answer        (most shots)
                                                                └─► tier 2: full relay-BP     (risky shots)
```

## Results
Every decoder decoded the same fresh shots (seed 7: 30,000 / 10,000 / 5,000 independent X/Z pairs). Latency was measured on separate single-worker timing shots (seed 8). Each cell: failed pairs · mean time per pair.

| p | BP-OSD | relay-BP | QEC-Aegis v1 | QEC-Aegis v2, speed | QEC-Aegis v2, accuracy |
|---|---|---|---|---|---|
| 0.003 | 184 · 52 ms | 32 · 36 ms | 41 · **8.0 ms** | 41 · 8.1 ms | 41 · 8.1 ms |
| 0.004 | 511 · 119 ms | 93 · 139 ms | 103 · **84 ms** | 103 · 84 ms | 99 · 94 ms |
| 0.005 | 1,196 · 212 ms | 407 · 484 ms | 367 · 397 ms | 399 · **325 ms** | **359** · 482 ms |

**Where it works**
- **Faster than relay-BP at equal accuracy:** 4.5× (p = 0.003) and 1.7× (p = 0.004) with v1, and 1.5× at p = 0.005 with v2 speed mode. No difference in failures is significant (McNemar p ≥ 0.17).
- **More accurate at the highest noise:** at p = 0.005, v2 accuracy mode fails on 359 pairs vs relay-BP's 407 (LER ratio 0.88, McNemar p = 0.002), at the same mean time.
- **Far ahead of BP-OSD:** 3–5× fewer failed pairs at every p.

**Where it falls short**
- **Tail latency:** the slowest 1% of shots are slower than relay-BP (p99 4.3 vs 2.7 s at p = 0.005), because escalated shots pay for both tiers.
- **Missed wrong answers:** the risk model still lets some through.
- **Implementation:** pure Python on a laptop CPU, far from real-time budgets.

<p align="center">
  <img src="results/figures/v2_ler_vs_p.png" alt="Logical error rate per cycle against p for every decoder" width="70%">
</p>

![Mean and 99th-percentile decode time per X/Z pair, single worker](results/figures/v2_latency.png)

**Every figure, with how to read it, and every limitation:** [`docs/RESULTS.md`](docs/RESULTS.md).

## Quickstart
Tested with Python 3.13. `relay-bp` builds with Rust ([rustup.rs](https://rustup.rs)).

```bash
python3 -m venv .venv
.venv/bin/pip install -r challenge-1-ml-decoder-kit/requirements-dev.txt
ln -s ../.venv challenge-1-ml-decoder-kit/.venv          # the kit's scripts expect their own .venv

.venv/bin/python -m aegis.demo --p 0.005 --shots 15     # live demo: fresh shots, QEC-Aegis vs relay-BP
scripts/reproduce.sh                                    # check everything: tests, model hashes, data, results, plots
```

Demo output (abridged):
```
shot alarms       tier 1     risk tier 2  Aegis ms relay-BP ms  correct (Aegis / relay-BP)
   1    174    converged  6.6e-05     no       2.5        25.7  yes / yes
   8    165    converged  6.3e-02     no      73.7       157.0  yes / yes
  14    175    converged  1.5e-01     no      66.9       215.3  NO / yes
15 shots: QEC-Aegis 14 correct, mean 100.9 ms; relay-BP 15 correct, mean 197.5 ms (2.0x).
```
Shot 14 is the failure mode in miniature. Tier 1 converged to a wrong answer, and the model rated its risk 0.15, below the 0.288 threshold, so it was not escalated.

## What is in this repository

| Folder | What it is | Main files |
|---|---|---|
| [`aegis/`](aegis/) | **Source code**: the decoder and everything that trains and evaluates it | `decoder.py`, `tiers.py`, `features.py`, `model.py`, `collect.py`, `train.py`, `retune.py`, `evaluate_v2.py`, `demo.py` |
| [`tests/`](tests/) | **Tests** of the source code (55) | `test_aegis.py`, `test_science.py`, `test_loss.py`, `test_end_to_end.py` |
| [`models/`](models/) | **Trained models**, frozen before testing | `aegis_router*.joblib` (v1), `v2/aegis_{speed,accuracy}_*.joblib` (v2) |
| [`data/`](data/) | **Data**: per-shot records of every decoder on validation, test and timing shots | `val_*`, `test_*`, `test2_*`, `timing*_*.npz`, `manifest.json` |
| [`results/`](results/) | **Results**: evaluations, tables, CSV, frozen hashes and every plot | `tables.md`, `v2_summary.csv`, `figures/` |
| [`scripts/`](scripts/) | **Run scripts** | `reproduce.sh` (check everything), `run_fresh_evaluation.sh` (decode the fresh shots again) |
| [`docs/`](docs/) | **Explanations** | `HOW_IT_WORKS.md`, `RESULTS.md`, `PRESENTATION.md` |
| [`challenge-1-ml-decoder-kit/`](challenge-1-ml-decoder-kit/) | **The organisers' kit**, plus the team's erasure-flag study | `circuit.py`, `decoders.py`, `ERASURE.md` |

How the folders connect: code in `aegis/` turns shots into `data/`, `data/` into `models/`, and both into `results/`.

## Challenge deliverables

| The brief asks for | Where it is |
|---|---|
| A working decoder | [`aegis/decoder.py`](aegis/decoder.py) with the models in [`models/`](models/) |
| Code that generates training and test data | [`aegis/collect.py`](aegis/collect.py); commands in [`docs/RESULTS.md`](docs/RESULTS.md#5-data-and-how-to-regenerate-it) |
| A script that reproduces the evaluation | [`scripts/reproduce.sh`](scripts/reproduce.sh) |
| Comparison with the baselines, with a plot | [Results](#results), [`docs/RESULTS.md`](docs/RESULTS.md), [`results/`](results/) |
| A short presentation or demo | Slides: [`docs/QEC-Aegis_MidQWest_2026.pptx`](docs/QEC-Aegis_MidQWest_2026.pptx) · notes: [`docs/PRESENTATION.md`](docs/PRESENTATION.md) · live demo: `python -m aegis.demo` |

## How the numbers were obtained
- **Separate shots for every step:** the model is trained on seed-1 shots, calibrated on seed-4 shots, and its thresholds are chosen on seed-3 validation shots.
- **Frozen before testing:** model files are hashed before any test shot is decoded: v1 before seed 2; v2 before the fresh seeds 7 and 8.
- **Fair comparisons:** every decoder decodes identical shots and is scored on the same independent X/Z pairs, with exact intervals and paired McNemar tests.
- **Clean timing:** latency is measured on one worker with nothing else running.

Details: [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md#4-the-scientific-protocol).

## Companion study: erasure flags
On neutral-atom hardware, some errors can be heralded as erasures with a known location. Giving those flags to relay-BP on the same shots (50% of noise flagged) cuts failed pairs from **41 to 2** at p = 0.004 and from **138 to 6** at p = 0.005. Decoding also becomes 2–5× faster on average. With degraded flags (30% missed, ~30% false, or timing known only to within 1–3 rounds) failures stay at 2–4 against 18 flag-blind on the same 10,000 pairs at p = 0.004. Not modeled: a lost atom stays lost, so later gates on it do nothing. Full study: [`challenge-1-ml-decoder-kit/ERASURE.md`](challenge-1-ml-decoder-kit/ERASURE.md).
