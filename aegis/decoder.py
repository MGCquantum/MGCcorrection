"""The routed decoder: tier 1, the risk model, and tier 2 on the shots the model flags."""
from dataclasses import dataclass
import time

import joblib
import numpy as np

from .tiers import TierResult, build


def load_model(path):
    return joblib.load(path)


@dataclass
class AegisResult(TierResult):
    risk: float = np.nan              # estimated chance that the tier-1 answer is logically wrong
    escalated: bool = False
    seconds_tier1: float = 0.0
    seconds_model: float = 0.0
    seconds_tier2: float = 0.0
    tier1_weight: float = 0.0
    tier2_weight: float = np.nan


def better(first, second):
    """Of two tier answers, the one to keep: a converged one, and of two converged the lighter."""
    if second.converged and (not first.converged or second.weight <= first.weight):
        return second
    return first


class AegisDecoder:
    """decode_shot(syndrome, other_weight, fired) -> AegisResult.

    Tier 1 runs on every shot. The model scores it. At or above the threshold tier 2 runs and the
    better of the two answers is returned. A tier-1 run that did not converge always escalates.
    """
    has_features = True

    def __init__(self, problem, model, threshold=None, use_flags=False, tier1=None, tier2=None):
        """Tiers and threshold default to the ones stored with the model (chosen on validation data)."""
        suffix = "+flags" if use_flags and problem.f else ""
        tier1 = (tier1 or model.meta["tier1"]).split("+")[0]
        tier2 = (tier2 or model.meta["tier2"]).split("+")[0]
        self.tier1, self.tier2 = build(tier1 + suffix, problem), build(tier2 + suffix, problem)
        self.model = model
        self.threshold = model.meta["threshold"] if threshold is None else threshold

    def reset(self):
        self.tier1.reset()
        self.tier2.reset()

    def decode_shot(self, syndrome, other_weight=0, fired=()):
        start = time.perf_counter()
        first = self.tier1.decode_shot(syndrome, other_weight, fired)
        scored = time.perf_counter()
        risk = self.model.risk(first.features)
        decided = time.perf_counter()
        out = AegisResult(first.error, first.converged, first.iterations, first.weight, None, first.features, risk=risk,
                          seconds_tier1=scored - start, seconds_model=decided - scored, tier1_weight=first.weight)
        if risk >= self.threshold:
            second = self.tier2.decode_shot(syndrome, other_weight, fired)
            best = better(first, second)
            out.error, out.converged, out.weight = best.error, best.converged, best.weight
            out.iterations = first.iterations + second.iterations
            out.escalated, out.tier2_weight = True, second.weight
            out.seconds_tier2 = time.perf_counter() - decided
        return out
