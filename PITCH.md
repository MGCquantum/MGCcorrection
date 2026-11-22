# Pitch notes (not part of the code spec)

## Pitch cheat sheet
**Claim:** "Infleqtion's atoms announce when they are lost. We feed those flags to relay-BP, the strongest decoder in the kit. With half the noise flagged, on the same simulated shots, failures drop from 36 to 3 (p = 0.004, 20,000 independent pairs) and from 140 to 9 (p = 0.005, 10,000 pairs), and decoding gets 2–5× faster on average with 6–12× lower p99 latency. Flags are idealized: instant and exact. Our learned convergence router did not beat a simple rule; we report that honestly."

**Order:** (1) problem: atoms flag some failures; (2) erasure result: the headline; (3) speed and the router finding; (4) limits and next steps.

**Evidence:** corrected erasure priors, all three required noise levels, both baselines, 45 local tests and the automated data audit (73 checks). See [AUDIT.md](AUDIT.md) and [the evaluation table](challenge-1-ml-decoder-kit/results_v2/results.csv).

**Answers to have ready:**
- "Why use both BP-OSD and relay-BP?" BP-OSD takes new priors per shot, so it was the first flag-aware decoder. relay-BP has no prior update, so we rebuild it per shot (about 17 ms, counted in its time); that is the headline result. With BP-OSD the gain is significant at 50% and 75% flagged, but each flag-aware decode is 5–7× slower.
- "Are the error bars valid?" Yes: the current data uses separate random streams for X and Z (and for training and test), derived from fixed root seeds, so every X/Z pair is independent and the exact intervals and McNemar tests apply. Our first caches shared one stream for X and Z; we analyse those with disjoint halves and keep them only as history.
- "Isn't this just Bayes?" Yes: the right prior given a flag is known exactly, so no learning is needed there. That's why we put the ML where the brief suggested, in routing, and found the limit.
- "Real loss is detected late." Agreed; our erasures are idealized. Realistic delayed loss is next.
- "Isn't the hybrid just relay-BP with stop_nconv=1?" Essentially, yes. That's the point: the cheap check already does the routing.

| Term | Say it as |
|---|---|
| Logical error rate per cycle | How often the stored information comes back wrong, per round of checks |
| Syndrome / detectors | The alarms: which checks flipped |
| Decoder | The software that guesses which errors caused the alarms |
| BP converged | The fast decoder found an explanation that fits every alarm |
| Escalated | Sent to the slow, stronger decoder |
| Erasure / loss flag | A flag identifying where an erasure event occurred (idealized here) |
| Prior | How likely the decoder thinks each error is before it looks at the alarms |
| p99 latency | The time 99% of shots finish within |

**Likely judge questions:**
- "Isn't it obvious that flags help?" Yes, that part is expected. The point is *how much*, measured on the Gross code as a function of erasure fraction, which is the number a hardware team needs.
- "Can fast BP converge and still be wrong?" Not once in 14,089 converged test shots in the current data (2 of 14,166 in our earlier caches, both at p = 0.005).

## Live demonstration

From `challenge-1-ml-decoder-kit`, run `.venv/bin/python demo.py --p 0.004 --basis X`,
then repeat with `--basis Z`. The demo is illustrative: a correct decoder can still fail
on a noisy shot, so it prints CORRECT or WRONG rather than failing. The asserted checks
of the real fast-BP, relay-BP and fallback paths are in `test_submission.py`.
The demo prints the CPU, matrix, model size, setup cost and peak process memory.

## Pitch (3 minutes)
1. Decoding is a classical computing bottleneck, and neutral atoms tell you where they failed.
2. The erasure plot.
3. The ML router and the speed numbers.
4. Where it falls short: the convergence hybrid's slow tail, and wide error bars where failures are few.
