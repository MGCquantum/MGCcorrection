# Historical planning spec (superseded)

This document records hypotheses and planned filenames, not the final implementation or acceptance criteria. See [AUDIT.md](AUDIT.md), [README.md](README.md), and [RUN.md](challenge-1-ml-decoder-kit/RUN.md) for current behavior. In particular, both baselines are now required and available at all three p values; flag-blind error rates can fall with erasure conversion; ML superiority is not established.

## Original spec v2: erasure-aware hybrid decoder for the Gross code

**Goal:** measure (a) how much heralded-erasure flags reduce the logical error rate on the Gross code, and (b) whether an ML difficulty router keeps relay-BP accuracy at lower mean decode time.

## First measurements
Claude's 2-core machine, X basis, p = 0.004, 300 shots:

| Decoder | Converged | Wrong | Mean | p99 |
|---|---|---|---|---|
| Plain BP, 30 iterations | 81 | — | 9 ms | 13 ms |
| Plain BP, 200 iterations | 222 | 68 (incl. non-converged) | 24 ms | 66 ms |
| relay-BP | — | 2 | 214 ms (median 53) | 2,700 ms |

What this means:
- At 30 iterations, BP was never wrong when it converged (0 of 81). So a router trained on "BP converged but wrong" has nothing to learn. **That router is dropped.**
- Routing easy shots to fast BP saves mean time, probably about 1.3–2×. It does not fix relay-BP's slow tail.
- relay-BP's Python API has no per-shot prior update. So the loss experiment uses `ldpc` (BP and BP-OSD), which has `update_channel_probs`.

## What we build
1. **`loss_circuit.py`.** Holds the total error rate p fixed and turns a fraction f of the data-qubit errors into heralded erasures (`HERALDED_ERASE`), with the herald bits recorded per shot.
2. **`loss_priors.py`.** For each shot, sets the prior of every error tied to a fired herald to 0.5 and every unfired one to 0, then decodes with BP-OSD.
3. **`hybrid.py` with an ML difficulty router.**
   - Before decoding, a small classifier reads the syndrome weight, the flag count and the flag positions. It predicts whether fast BP (200 iterations) will converge.
   - Easy shots go to BP; hard shots skip straight to relay-BP or BP-OSD.
   - The labels are balanced (about 74% converge vs 26% don't), so the model has a real job.
4. **`evaluate.py`.** Runs each expensive decoder once per shot and caches its answer, time and convergence. Every hybrid variant is then computed offline from that cache.

## Experiments
1. **Required sweep:** p = 0.003, 0.004, 0.005. Decoders: relay-BP, BP-OSD (at p = 0.004 only; cite the kit for the rest), and the hybrid. Shots per basis: 2,000 at 0.004 and 0.005, 5,000 at 0.003.
2. **Headline experiment:** erasure fraction f = 0, 0.25, 0.5, 0.75 at p = 0.004, decoded with and without the flags.

## What "working" means
1. **Baselines** match the kit README within error bars.
2. **Erasure plot:** with flags, the error rate falls as f rises; without flags, it doesn't. Report the factor ("converting half the errors to erasures cuts the error rate N×").
3. **Hybrid:**
   - Error rate equal to relay-BP's at p = 0.004 and 0.005. At p = 0.003 the error bars are too wide to claim this, so say so.
   - Lower mean time.
   - Report the % of shots escalated.
4. **Router:** beats a simple syndrome-weight threshold at predicting convergence. Report its accuracy.

Report every result, including the ones that fail, with the reason.

## Timing rule
- Time only the decode call itself, not data loading or Python setup.
- Run all final timings on one laptop with nothing else running.
- Each slide notes that relay-BP is compiled Rust and the router is Python.
