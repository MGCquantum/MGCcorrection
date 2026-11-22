"""Features the risk model reads. All of them exist at decode time.

Inputs: the syndrome of the shot, its herald flags, the nominal noise strength, what tier 1
returned and, for shots tier 1 found hard, whether a cheap second decoder predicts the same
logical outcome. Nothing depends on the true error or the true observables.

The syndrome covers the whole memory experiment (all rounds), as it does for the baselines.
A sliding-window decoder would have to restrict the temporal features to its window.
"""
import numpy as np

GROUPS = {
    "tier1": ["converged", "log_iterations", "first_leg", "solution_weight", "solution_size", "weight_per_defect",
              "size_per_defect", "uncertain_bits", "min_margin", "mean_margin_flipped", "weak_flips"],
    "syndrome": ["syndrome_weight", "other_basis_weight", "distinct_checks", "max_check_repeats", "log10_p"],
    "temporal": ["max_round_weight", "round_weight_std", "max_round_jump", "first_round_weight", "last_round_weight",
                 "late_fraction"],
    "loss": ["heralds", "herald_columns", "solution_on_heralds"],
    "second": ["second_run", "second_disagrees", "second_weight_gap"],
}
NAMES = [name for group in GROUPS.values() for name in group]


def columns_of(groups):
    """Indices of the features of the named groups."""
    wanted = {name for group in groups for name in GROUPS[group]}
    return [k for k, name in enumerate(NAMES) if name in wanted]


def extract(syndrome, result, weights, problem, pre_iter, other_weight=0, fired=(), herald_columns=(), second=None):
    """Feature vector (order of NAMES) of one shot after tier 1.

    result is a tiers.TierResult with relay-BP posteriors. weights are the log-likelihood weights
    of the priors tier 1 used. second is None, or (disagrees, weight gap) from the second opinion
    that tiers.RelayTier runs when tier 1 needed more than its first leg.
    """
    flipped = result.error.astype(bool)
    defects = int(syndrome.sum())
    weight, size = float(weights[flipped].sum()), int(flipped.sum())
    # relay-BP's posterior ratio is positive for a bit it leaves alone and negative for a flip.
    # Divided by the prior weight, a magnitude near or below 1 means BP was not sure.
    margin = np.abs(result.posterior) / np.maximum(weights, 1.0)
    grid = syndrome.reshape(problem.rounds, problem.checks).astype(np.int64)
    per_round, per_check = grid.sum(axis=1), grid.sum(axis=0)
    on_heralds = int(flipped[herald_columns].sum()) if len(herald_columns) else 0
    values = {
        "converged": result.converged, "log_iterations": np.log1p(result.iterations),
        "first_leg": result.iterations <= pre_iter, "solution_weight": weight, "solution_size": size,
        "weight_per_defect": weight / max(defects, 1), "size_per_defect": size / max(defects, 1),
        "uncertain_bits": int((margin < 1.0).sum()), "min_margin": float(margin.min()),
        "mean_margin_flipped": float(np.minimum(margin[flipped], 50.0).mean()) if size else 50.0,
        "weak_flips": int((margin[flipped] < 2.0).sum()),
        "syndrome_weight": defects, "other_basis_weight": other_weight,
        "distinct_checks": int((per_check > 0).sum()), "max_check_repeats": int(per_check.max()),
        "log10_p": np.log10(problem.p),
        "max_round_weight": int(per_round.max()), "round_weight_std": float(per_round.std()),
        "max_round_jump": int(np.abs(np.diff(per_round)).max()), "first_round_weight": int(per_round[0]),
        "last_round_weight": int(per_round[-1]), "late_fraction": float(per_round[-3:].sum() / max(defects, 1)),
        "heralds": len(fired), "herald_columns": len(herald_columns), "solution_on_heralds": on_heralds,
        "second_run": second is not None, "second_disagrees": bool(second and second[0]),
        "second_weight_gap": float(second[1]) if second else 0.0,
    }
    return np.array([values[name] for name in NAMES], np.float32)
