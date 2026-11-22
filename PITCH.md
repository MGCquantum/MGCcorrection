# Pitch notes (not part of the code spec)

## Pitch cheat sheet
**Claim:** "Neutral atoms can convert some errors into flagged erasures. On the Gross code, decoding the same shots with the flags gave 4 failures instead of 22 (about 5× fewer, p < 0.0001) when half the noise was flagged. The cost is about 6× more decode time. We also asked where learning belongs in a hierarchical decoder: a learned router can't help, because BP's own convergence check already routes almost perfectly, and even a perfect router would save under 17%."

**Order:** (1) problem: atoms flag some failures; (2) erasure result: the headline; (3) speed and the router finding; (4) limits and next steps.

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
| Erasure / loss flag | The hardware saying "this atom is gone, the error is here" |
| Prior | How likely the decoder thinks each error is before it looks at the alarms |
| p99 latency | How long the slowest 1% of shots take |

**Likely judge questions:**
- "Isn't it obvious that flags help?" Yes, that part is expected. The point is *how much*, measured on the Gross code as a function of erasure fraction, which is the number a hardware team needs.
- "Can fast BP converge and still be wrong?" In principle, yes. In our test it never happened (0 of 81), which is why the router predicts difficulty rather than wrongness.

## Schedule
- Loss go/no-go at 8 pm. If loss isn't working, ship the hybrid and router only.
- Final sweeps start by 11 pm and run overnight.
- Numbers locked at 10 am; slides and README until 1:30 pm; push by 1:45 pm. Code freeze is 2:00 pm.

## Pitch (3 minutes)
1. Decoding is a classical computing bottleneck, and neutral atoms tell you where they failed.
2. The erasure plot.
3. The ML router and the speed numbers.
4. Where it falls short: the slow tail, and the wide error bars at p = 0.003.
