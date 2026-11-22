"""Independent checks of the science behind the results: the [[144,12,12]] Gross code is rebuilt here
from its published polynomials with code written in this file (not the kit's helpers) and compared
with what the kit and the circuits use; the reporting conventions are checked against the kit's own
analysis code. Local, fast, deterministic.

Reference: Bravyi, Cross, Gambetta, Maslov, Rall, Yoder, "High-threshold and low-overhead
fault-tolerant quantum memory", Nature 627, 778 (2024): l = 12, m = 6, A = x^3 + y + y^2,
B = y^3 + x + x^2, H_X = [A | B], H_Z = [B^T | A^T].
"""
import itertools
import sys

import numpy as np
import pytest

from aegis.paths import ROOT

sys.path.insert(0, str(ROOT / "challenge-1-ml-decoder-kit"))
import make_circuit as mc  # noqa: E402

from aegis import policy  # noqa: E402

L, M = 12, 6


def shift(n, k):
    S = np.zeros((n, n), np.uint8)
    for i in range(n):
        S[i, (i + k) % n] = 1
    return S


def xp(k):
    return np.kron(shift(L, k), np.eye(M, dtype=np.uint8))


def yp(k):
    return np.kron(np.eye(L, dtype=np.uint8), shift(M, k))


def rank2(Mat):
    """GF(2) rank by Gaussian elimination (independent of make_circuit.gf2_rank)."""
    A = (Mat.copy() % 2).astype(np.uint8)
    r = 0
    for c in range(A.shape[1]):
        piv = np.flatnonzero(A[r:, c])
        if not len(piv):
            continue
        p = r + piv[0]
        A[[r, p]] = A[[p, r]]
        rows = np.flatnonzero(A[:, c])
        rows = rows[rows != r]
        A[rows] ^= A[r]
        r += 1
        if r == A.shape[0]:
            break
    return r


@pytest.fixture(scope="module")
def code():
    A = (xp(3) + yp(1) + yp(2)) % 2
    B = (yp(3) + xp(1) + xp(2)) % 2
    hx = np.hstack([A, B]).astype(np.uint8)
    hz = np.hstack([B.T, A.T]).astype(np.uint8)
    return hx, hz


def test_kit_uses_the_published_gross_parameters():
    ell, m, a, b, rounds = mc.CODES["gross"]
    assert (ell, m, tuple(a), tuple(b), rounds) == (12, 6, (3, 1, 2), (3, 1, 2), 12)


def test_independent_construction_equals_the_kit(code):
    hx, hz = code
    layout = mc.code_layout("gross")
    assert np.array_equal(hx, layout.hx.astype(np.uint8))
    assert np.array_equal(hz, layout.hz.astype(np.uint8))


def test_css_condition_ranks_and_logical_dimension(code):
    hx, hz = code
    assert not ((hx.astype(int) @ hz.T.astype(int)) % 2).any()      # H_X H_Z^T = AB + BA = 0 (A, B commute)
    assert rank2(hx) == rank2(hz) == 66
    assert hx.shape[1] - rank2(hx) - rank2(hz) == 12                # k = n - rank H_X - rank H_Z
    assert set(hx.sum(1)) == set(hz.sum(1)) == {6} and set(hx.sum(0)) == set(hz.sum(0)) == {3}


def test_logical_operators_are_valid_independent_and_paired(code):
    hx, hz = code
    lx = mc.logical_operators(hx, hz).astype(np.uint8)              # X-type
    lz = mc.logical_operators(hz, hx).astype(np.uint8)
    assert lx.shape == lz.shape == (12, 144)
    assert not ((hz.astype(int) @ lx.T) % 2).any() and not ((hx.astype(int) @ lz.T) % 2).any()
    # Not stabilizers, and independent modulo the stabilizers.
    assert rank2(np.vstack([hx, lx])) == 66 + 12 and rank2(np.vstack([hz, lz])) == 66 + 12
    # The pairing matrix Lx Lz^T is invertible over GF(2): 12 independent logical qubits.
    assert rank2((lx.astype(int) @ lz.T.astype(int)) % 2) == 12


def test_no_logical_operator_of_weight_three_or_less(code):
    """Exhaustive lower bound d >= 4 for both X and Z logicals. (d = 12 is the published value; the
    full search is NP-hard and is not repeated here.) Stabilizers have weight >= 6, so any nonzero
    kernel vector of weight <= 3 would be a logical operator."""
    hx, hz = code
    for h in (hx, hz):
        cols = [bytes(np.packbits(h[:, j])) for j in range(144)]
        assert len(set(cols)) == 144 and all(any(c) for c in cols)          # weight 1, 2: none
        index = {c: j for j, c in enumerate(cols)}
        for i, j in itertools.combinations(range(144), 2):
            s = bytes(a ^ b for a, b in zip(cols[i], cols[j]))
            k = index.get(s)
            assert k is None or k in (i, j), f"weight-3 kernel vector {i},{j},{k}"


def test_circuit_detectors_and_observables_match_the_code():
    import stim
    from circuit import GROSS_CIRCUITS
    for basis in "XZ":
        c = stim.Circuit.from_file(GROSS_CIRCUITS[basis])
        assert c.num_qubits == 288                                   # 144 data + 72 X + 72 Z ancillas
        assert c.num_detectors == 144 * 12                           # both check types, 12 cycles
        assert c.num_observables == 12
        # Noiseless circuit: no detector or observable ever flips.
        clean = c.without_noise()
        dets, obs = clean.compile_detector_sampler(seed=1).sample(64, separate_observables=True)
        assert not dets.any() and not obs.any()


def test_pair_and_per_cycle_conventions_equal_the_kit():
    """Pairs, per-cycle rate, exact interval and pair time are those of the team's analyze.py."""
    import analyze
    rng = np.random.default_rng(7)
    fx, fz = rng.random(5000) < 0.03, rng.random(5000) < 0.02
    tx, tz = rng.random(5000) * 0.01, rng.random(5000) * 0.02
    s = policy.summarize(fx, fz, tx, tz)
    failed, ms = analyze.pair_arrays({"d": (fx, tx)}, {"d": (fz, tz)}, "d")
    rate, lo, hi, k = analyze.per_cycle_ci(failed)
    assert s["failures_pair"] == k == int(failed.sum())
    assert s["ler"] == pytest.approx(rate, rel=1e-12)
    assert s["ler"] == pytest.approx(1 - (1 - failed.mean()) ** (1 / 12), rel=1e-12)
    assert s["ler_ci95"] == pytest.approx([lo, hi], rel=1e-9)
    assert s["ms_mean"] == pytest.approx(ms.mean()) and s["ms_p99"] == pytest.approx(np.percentile(ms, 99))


def test_oracle_router_is_a_lower_bound_on_failures_and_time():
    """For every threshold, the threshold router fails at least as often as the oracle, and spends
    at least as long on the shots tier 1 got wrong."""
    rng = np.random.default_rng(3)
    n = 4000
    first = {"failed": rng.random(n) < 0.05, "converged": rng.random(n) > 0.02, "seconds": rng.random(n) * 0.01,
             "weight": rng.random(n)}
    first["failed"] |= ~first["converged"] & (rng.random(n) < 0.5)
    second = {"failed": rng.random(n) < 0.02, "converged": np.ones(n, bool), "seconds": 0.05 + rng.random(n) * 0.05,
              "weight": rng.random(n)}
    of, osec, oesc = policy.oracle_route(first, second)
    assert (of == (first["failed"] & second["failed"])).all()
    assert (oesc == (first["failed"] | ~first["converged"])).all()
    risk = rng.random(n)
    for thr in (0.0, 0.1, 0.5, 0.9, 1.1):
        f, sec, esc = policy.route(first, second, risk >= thr)
        assert f.sum() >= of.sum()
        need = first["failed"] & ~second["failed"]           # shots only tier 2 can fix
        assert sec[need & ~esc].sum() <= osec[need & ~esc].sum() + 1e-12   # skipping them is cheaper but fails


def test_evaluation_handles_timing_records_without_cached_tiers():
    """Timing records hold only bposd, relay and the online decoder. The final evaluate step crashed
    on them (KeyError 'relay1'), and the figures crashed on a result without a cached 'aegis' row."""
    from aegis import evaluate, figures
    rng = np.random.default_rng(0)
    n = 300

    def tier():
        return {"failed": rng.random(n) < 0.02, "seconds": rng.random(n) * 0.01}

    def online():
        return tier() | {"escalated": rng.random(n) < 0.05, "seconds_model": np.full(n, 1e-5), "seconds_tier1": np.full(n, 5e-3)}

    class Stub:
        meta = {"tier1": "relay1", "tier2": "relay", "threshold": 0.1, "name": "gbm"}

    x, z = ({"bposd": tier(), "relay": tier(), "aegis": online()} for _ in range(2))
    out = evaluate.evaluate_setting(x, z, {"aegis": Stub()}, timing=True)
    assert set(out["decoders"]) == {"bposd", "relay", "tier 2 alone", "aegis (online)"}
    assert "aegis (online) vs relay" in out["comparisons"] and "model_quality" not in out
    assert figures.final(out["decoders"]) is out["decoders"]["aegis (online)"]


def test_committed_models_are_the_frozen_ones():
    """models/*.joblib are byte for byte the files recorded before any test shot was decoded."""
    import hashlib
    import json
    frozen = json.loads((ROOT / "experiments" / "reports" / "frozen_models.json").read_text())["models"]
    for name, digest in frozen.items():
        assert hashlib.sha256((ROOT / "models" / name).read_bytes()).hexdigest() == digest, name


def test_frozen_router_still_meets_its_selection_rule_with_independent_pairs():
    """aegis.recheck: the speed-mode router, unchanged, fails on no more validation pairs than relay-BP
    at any p when X shot k is paired with Z shot z_partner(n)[k] (validation records only)."""
    import joblib
    from aegis import recheck
    result = recheck.recheck("speed", joblib.load(ROOT / "models" / "aegis_router.joblib"))
    assert result["rule_holds"]
    for s in result["per_setting"].values():
        assert s["failures_pair"] <= s["relay_failures"] and s["ms_mean"] < s["relay_ms"]


def test_required_evaluation_section_covers_the_challenge_metrics():
    """docs/RESULTS.md opens with the Challenge 1 sweep: BP-OSD, relay-BP and QEC-Aegis at every p, with
    LER, latency percentiles and resources, all read from the committed reports on the same test pairs."""
    import json
    from aegis import report
    reports = ROOT / "experiments" / "reports"
    ev = json.loads((reports / "evaluation.json").read_text())
    res = json.loads((reports / "resources.json").read_text())
    text = "\n".join(report.required_evaluation(ev, res))
    for p in ("0.003", "0.004", "0.005"):
        pairs = {ev["sweep"][p]["decoders"][k]["pairs"] for k in ("bposd", "relay", "aegis (online)")}
        assert len(pairs) == 1                                  # one set of test pairs per p
        for label in ("BP-OSD", "relay-BP", "QEC-Aegis"):
            assert f"| {p} | {label} |" in text
    for column in ("LER per cycle", "Median ms", "p99 ms", "Peak MB", "Model inference per shot"):
        assert column in text
    assert {r["decoder"] for r in res["rows"]} == {"bposd", "relay", "aegis"}
    assert {r["p"] for r in res["rows"]} == {0.003, 0.004, 0.005}
