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

from mgccorrection.paths import ROOT

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
    import analyze
    rng = np.random.default_rng(7)
    fx, fz = rng.random(5000) < 0.03, rng.random(5000) < 0.02
    s = policy.summarize(fx, fz, np.full(5000, 0.01), np.full(5000, 0.01))
    rate, lo, hi, k = analyze.per_cycle_ci(fx | fz)
    assert s["failures_pair"] == k == int((fx | fz).sum())
    assert s["ler"] == pytest.approx(rate, rel=1e-12)
    assert s["ler"] == pytest.approx(1 - (1 - (fx | fz).mean()) ** (1 / 12), rel=1e-12)


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
