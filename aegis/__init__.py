"""QEC-Aegis: a failure-aware adaptive decoder for the [[144,12,12]] Gross code.

Tier 1 is relay-BP stopped at its first solution. A learned risk model reads the syndrome,
the herald flags and how tier 1 went, and estimates the chance that the tier-1 answer is
logically wrong. Shots above a threshold go to tier 2, a larger relay-BP ensemble.

Everything is a local simulation. Nothing here talks to quantum hardware or a cloud service.
"""
import mgccorrection  # noqa: F401  (puts the starter kit on the import path)

CYCLES = 12
# Seeds. 1 and 2 follow TEAM_PLAN.md. The test seed is frozen: nothing is tuned on it.
TRAIN_SEED, TEST_SEED, VAL_SEED, CALIB_SEED = 1, 2, 3, 4
