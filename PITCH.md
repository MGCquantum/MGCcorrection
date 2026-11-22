# Pitch notes (not part of the code spec)

## Pitch cheat sheet
**Claim:** "Infleqtion's atoms announce when they are lost. We feed those flags to relay-BP, the strongest decoder in the kit. With half the noise flagged, on the same simulated shots, failures drop from 41 to 2 (p = 0.004, 20,000 pairs) and from 138 to 6 (p = 0.005), and decoding gets 2–5× faster on average and 6–11× faster on the slowest 1%. Flags are idealized: instant and exact. Our learned convergence router did not beat a simple rule; we report that honestly."

**Order:** (1) problem: atoms flag some failures; (2) erasure result: the headline; (3) speed and the router finding; (4) limits and next steps.

**Evidence:** corrected erasure priors, all three required noise levels, both baselines, 32 local tests and the automated data audit. See [AUDIT.md](AUDIT.md) and [the evaluation table](challenge-1-ml-decoder-kit/results/results.csv).

**Answers to have ready:**
- "Why BP-OSD, not relay-BP?" relay-BP can't take new priors per shot. Flags in relay-BP is the next step.
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
| p99 latency | How long the slowest 1% of shots take |

**Likely judge questions:**
- "Isn't it obvious that flags help?" Yes, that part is expected. The point is *how much*, measured on the Gross code as a function of erasure fraction, which is the number a hardware team needs.
- "Can fast BP converge and still be wrong?" Rarely: 2 of 14,166 converged test shots, both at p = 0.005.

## Live demonstration

From `challenge-1-ml-decoder-kit`, run `.venv/bin/python demo.py --p 0.004 --basis X`,
then repeat with `--basis Z`. The recorded seed-99 local examples exercise both
fast-BP acceptance and escalation to relay-BP, with correct logical predictions.
The demo prints the CPU, matrix, model size, setup cost and peak process memory.

## Pitch (3 minutes)
1. Decoding is a classical computing bottleneck, and neutral atoms tell you where they failed.
2. The erasure plot.
3. The ML router and the speed numbers.
4. Where it falls short: the slow tail, and the wide error bars at p = 0.003.
