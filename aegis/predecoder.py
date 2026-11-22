"""Approach B, tested and not adopted: a learned predecoder in front of relay-BP.

  python -m aegis.predecoder --p 0.004 --shots 1500

The model is local and translation-invariant. For every error mechanism it looks at how many of
the mechanism's own detectors fired (k of m) and at its prior, and predicts the chance that the
mechanism fired. It is learned from labelled samples of the detector error model, where the
fired mechanisms are known. Two ways to use it are compared with plain tier 1 on validation shots:

  soft   the predictions replace the priors of tier 1 (learned prior adaptation)
  hard   mechanisms predicted above a confidence level are committed first and tier 1 decodes
         the remaining syndrome (residual decoding)

Result (experiments/reports/predecoder_p<p>.json): see docs/METHODOLOGY.md. In short, neither
variant beats plain tier 1, because relay-BP's first iterations already do this local inference
and reusing the syndrome twice makes the adapted priors overconfident.
"""
import argparse
import json
import time

import numpy as np

from . import VAL_SEED
from .problem import Problem
from .tiers import RelayTier, llr
from .train import REPORTS


def fit_table(problem, shots, seed):
    """P(mechanism fired | m, k, prior bin) from samples of the error model."""
    rng = np.random.default_rng(seed)
    H = problem.H.tocsc()
    m = np.asarray(H.sum(axis=0)).ravel().astype(int)
    bins = np.digitize(np.log10(problem.priors), np.linspace(-3.2, -1.8, 8))
    fired_count = np.zeros((m.max() + 1, m.max() + 1, bins.max() + 1))
    total = np.zeros_like(fired_count)
    for _ in range(shots // 500):
        errors = (rng.random((500, H.shape[1])) < problem.priors).astype(np.uint8)
        syndromes = np.asarray((H @ errors.T).T % 2, np.int32)
        k = syndromes @ H
        np.add.at(total, (np.broadcast_to(m, k.shape), k, np.broadcast_to(bins, k.shape)), 1)
        np.add.at(fired_count, (np.broadcast_to(m, k.shape), k, np.broadcast_to(bins, k.shape)), errors)
    table = (fired_count + 5e-4) / (total + 1e-3)   # empty cells default to 1/2
    return table, m, bins


def run(p, shots, train_shots=20000, commit=0.7):
    problem = Problem("X", p)
    table, m, bins = fit_table(problem, train_shots, seed=11)
    syndromes, _, obs, _ = problem.sample(shots, VAL_SEED)
    H = problem.H.tocsc()
    plain = RelayTier(problem, stop_nconv=1, num_sets=10)
    adapted = RelayTier(problem, stop_nconv=1, num_sets=10)
    out = {name: {"failed": 0, "unconverged": 0, "seconds": 0.0, "iterations": 0} for name in ("tier 1", "soft", "hard")}
    committed_total, committed_wrong = 0, 0

    def score(name, error, converged, seconds, iterations, truth):
        r = out[name]
        r["failed"] += int(((problem.L @ error) % 2 != truth).any())
        r["unconverged"] += int(not converged)
        r["seconds"] += seconds
        r["iterations"] += iterations

    for syndrome, truth in zip(syndromes, obs):
        start = time.perf_counter()
        base = plain.decode_shot(syndrome)
        score("tier 1", base.error, base.converged, time.perf_counter() - start, base.iterations, truth)

        start = time.perf_counter()
        k = syndrome.astype(np.int32) @ H
        predicted = np.clip(table[m, k, bins], 1e-7, 0.499)
        adapted._set_priors(predicted)
        adapted.weights = llr(predicted)
        soft = adapted.decode_shot(syndrome)
        score("soft", soft.error, soft.converged, time.perf_counter() - start, soft.iterations, truth)

        start = time.perf_counter()
        sure = np.flatnonzero(table[m, k, bins] > commit)
        # Commit confident mechanisms one at a time, skipping any that overlap an earlier commit.
        used, chosen = np.zeros(H.shape[0], bool), []
        for j in sure[np.argsort(-table[m[sure], k[sure], bins[sure]])]:
            rows = H.indices[H.indptr[j]:H.indptr[j + 1]]
            if not used[rows].any():
                used[rows] = True
                chosen.append(j)
        partial = np.zeros(H.shape[1], np.uint8)
        partial[chosen] = 1
        residual = (syndrome + H @ partial) % 2
        rest = plain.decode_shot(residual.astype(np.uint8))
        error = (partial + rest.error) % 2
        score("hard", error, rest.converged, time.perf_counter() - start, rest.iterations, truth)
        committed_total += len(chosen)
    for r in out.values():
        r["ms_mean"] = 1e3 * r.pop("seconds") / shots
        r["iterations_mean"] = r.pop("iterations") / shots
    return {"p": p, "basis": "X", "shots": shots, "split": "val", "train_shots": train_shots, "commit_level": commit,
            "committed_per_shot": committed_total / shots, "table_max": float(table.max()), "results": out}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--p", type=float, default=0.004)
    parser.add_argument("--shots", type=int, default=1500)
    parser.add_argument("--commit", type=float, default=0.7)
    args = parser.parse_args()
    report = run(args.p, args.shots, commit=args.commit)
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / f"predecoder_p{args.p}.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
