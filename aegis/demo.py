"""Live demo: fresh shots through relay-BP and QEC-Aegis v2, side by side.

  python -m aegis.demo                          p = 0.004, X basis, 20 shots, speed mode
  python -m aegis.demo --p 0.005 --mode accuracy --shots 50

Shots come from seed 99, which no training, validation, test or timing split uses. For every shot
it prints what tier 1 did, the risk the model gave its answer, whether tier 2 ran, the time of
each decoder and whether each one recovered the logical observables. Nothing is written to disk.
"""
import argparse
import time

from .decoder import AegisDecoder, load_model
from .paths import MODELS
from .problem import Problem
from .tiers import build

DEMO_SEED = 99


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--p", type=float, default=0.004, choices=(0.003, 0.004, 0.005))
    parser.add_argument("--basis", default="X", choices=("X", "Z"))
    parser.add_argument("--mode", default="speed", choices=("speed", "accuracy"))
    parser.add_argument("--shots", type=int, default=20)
    args = parser.parse_args()

    start = time.perf_counter()
    problem = Problem(args.basis, args.p)
    model = load_model(MODELS / "v2" / f"aegis_{args.mode}_p{args.p}.joblib")
    aegis, relay = AegisDecoder(problem, model), build("relay", problem)
    print(f"Gross code [[144,12,12]], {problem.rounds} rounds, basis {args.basis}, p = {args.p}: "
          f"{problem.H.shape[0]} checks x {problem.H.shape[1]} error mechanisms")
    print(f"QEC-Aegis v2 ({args.mode}): tier 1 {model.meta['tier1']}, tier 2 {model.meta['tier2']}, "
          f"escalate when risk >= {model.meta['threshold']:.3g} (chosen on validation shots); setup {time.perf_counter() - start:.1f} s\n")

    syndromes, other, observables, fired = problem.sample(args.shots, DEMO_SEED)
    print(f"{'shot':>4} {'alarms':>6} {'tier 1':>12} {'risk':>8} {'tier 2':>6} {'Aegis ms':>9} {'relay-BP ms':>11}  correct (Aegis / relay-BP)")
    totals = {"aegis": 0.0, "relay": 0.0}
    right = {"aegis": 0, "relay": 0}
    for k in range(args.shots):
        times, results = {}, {}
        for name, decoder in (("aegis", aegis), ("relay", relay)):
            t = time.perf_counter()
            results[name] = decoder.decode_shot(syndromes[k], int(other[k].sum()), fired[k])
            times[name] = time.perf_counter() - t
            totals[name] += times[name]
        ok = {name: bool(((problem.L @ r.error) % 2 == observables[k]).all()) for name, r in results.items()}
        for name in ok:
            right[name] += ok[name]
        a = results["aegis"]
        tier1 = "converged" if a.risk < 1 else "not conv."    # risk is 1 exactly when tier 1 did not converge
        print(f"{k:4d} {int(syndromes[k].sum()):6d} {tier1:>12} {a.risk:8.1e} {'yes' if a.escalated else 'no':>6} "
              f"{1e3 * times['aegis']:9.1f} {1e3 * times['relay']:11.1f}  {'yes' if ok['aegis'] else 'NO'} / {'yes' if ok['relay'] else 'NO'}")
        if (k + 1) % 50 == 0:      # decoders are reset every 50 shots, as in aegis.collect
            aegis.reset()
            relay.reset()
    print(f"\n{args.shots} shots: QEC-Aegis {right['aegis']} correct, mean {1e3 * totals['aegis'] / args.shots:.1f} ms; "
          f"relay-BP {right['relay']} correct, mean {1e3 * totals['relay'] / args.shots:.1f} ms "
          f"({totals['relay'] / max(totals['aegis'], 1e-12):.1f}x).")
    print("A demo is a functional check on a few shots; the error rates and latencies are in docs/RESULTS.md.")


if __name__ == "__main__":
    main()
