# Pitch notes (not part of the code spec)

## Pitch cheat sheet
**Claim:** "Neutral atoms can flag where some errors happened. On the Gross code, a decoder that uses those flags makes about 5.5× fewer logical errors than one that ignores them, when half the noise is flagged. The cost is about 6× more decode time. We also tested an ML router to save time; it ties a simple rule, and we show why."

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
