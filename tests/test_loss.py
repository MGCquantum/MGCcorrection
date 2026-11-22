"""Audit of the heralded-erasure model: the team's lossy.py and the priors built on it.

The model is a heralded-erasure approximation of atom loss (an erased qubit is replaced by a
maximally mixed one and flagged). It is not a full neutral-atom loss model.
"""
from collections import Counter

import numpy as np
import pytest
import stim

import lossy
from aegis.problem import Problem, erasure_model
from aegis.tiers import build
from circuit import GROSS_CIRCUITS, detector_ids, load_circuit

# One qubit, erased with probability 0.3 before a Z measurement. Detector 0 is the herald,
# detector 1 the measurement. An erasure flips the measurement with probability 1/2 (X or Y).
TINY = stim.Circuit("""
    R 0
    HERALDED_ERASE(0.3) 0
    DETECTOR(2) rec[-1]
    X_ERROR(0.1) 0
    M 0
    DETECTOR(1) rec[-1]
    OBSERVABLE_INCLUDE(0) rec[-1]
""")


def expected_faults(circuit):
    """Expected number of fault events per shot, per noise instruction.

    One event is one channel firing: DEPOLARIZE2 counts once per qubit pair, every other channel
    once per qubit.
    """
    faults = Counter()
    for instruction in circuit.flattened():
        args = instruction.gate_args_copy()
        if not stim.gate_data(instruction.name).is_noisy_gate or not args:
            continue
        qubits = sum(t.is_qubit_target for t in instruction.targets_copy())
        faults[instruction.name] += args[0] * qubits / (2 if instruction.name == "DEPOLARIZE2" else 1)
    return faults


@pytest.fixture(scope="module")
def tiny():
    return erasure_model(TINY, det_ids=[1], heralds=[0])


@pytest.fixture(scope="module")
def gross():
    return Problem("X", 0.004, f=0.5)


def test_flagged_erasure_flips_with_probability_one_half(tiny):
    """Analytic case, checked against 400,000 sampled shots."""
    H, L, blind, pauli, effects = tiny
    assert H.shape == (1, 1) and effects == {0: [(0, pytest.approx(0.5))]}
    det, _ = TINY.compile_detector_sampler(seed=1).sample(400_000, separate_observables=True)
    herald, flip = det[:, 0], det[:, 1]
    # Given the flag: erasure flip (1/2) XOR the ordinary X error (0.1) = 0.5.
    assert flip[herald].mean() == pytest.approx(0.5, abs=0.005)
    # Given no flag only the ordinary error is left: the Pauli-only prior.
    assert flip[~herald].mean() == pytest.approx(pauli[0], abs=0.003) and pauli[0] == pytest.approx(0.1)
    # Ignoring the flag: 0.15 XOR 0.1 = 0.22, the blind prior.
    assert flip.mean() == pytest.approx(blind[0], abs=0.003) and blind[0] == pytest.approx(0.22)


def test_team_flagged_prior_counts_components(gross):
    """lossy.py gives a flagged erasure column 1/4 per Pauli component merged into it, so 0.5 when the
    two Paulis that flip the column were merged: the analytic value above.

    Documented finding: it counts error-model entries, not probability. For about 6% of the erasure
    columns Stim has already merged X and Y into one entry (for example error(0.0005) D144 D1944 D4104),
    so lossy.py counts one component and sets 0.25, although the chance given the flag is still 1/2.
    aegis.problem divides probabilities instead and gets 1/2 for those columns too.
    """
    _, _, base, herald_col, n_components = lossy.aware_matrices(gross.circuit, gross.basis)
    erasure = herald_col >= 0
    priors = lossy.shot_priors(base, herald_col, np.unique(herald_col[erasure]), n_components)
    assert lossy.COMPONENT_PRIOR == 0.25
    assert set(np.unique(priors[erasure])) == {0.25, 0.5}
    assert (priors[erasure] == lossy.COMPONENT_PRIOR * n_components[erasure]).all()
    single = erasure & (n_components == 1)
    assert 0.05 < single.sum() / erasure.sum() < 0.08
    for herald in np.unique(herald_col[single]):
        assert [chance for _, chance in gross.herald_effects[int(herald)]] == [pytest.approx(0.5)]


def test_lossy_circuit_keeps_detectors_and_observables_valid():
    """With zero noise strength every detector, herald and observable of the lossy circuit is silent."""
    circuit = lossy.lossy_circuit(load_circuit(GROSS_CIRCUITS["Z"]), 0.0, 0.5)
    assert circuit.num_observables == 12 and len(lossy.herald_ids(circuit)) == circuit.num_detectors - 1728
    assert len(detector_ids(circuit, "Z")) == 936 and len(detector_ids(circuit, "X")) == 792
    det, obs = circuit.compile_detector_sampler(seed=0).sample(20, separate_observables=True)
    assert not det.any() and not obs.any()


def test_heralds_fire_at_the_erasure_rate(gross):
    """A herald fires at its erasure probability: f p after a one-qubit channel and f p / 2 per qubit
    after a two-qubit channel, so fewer than len(herald_ids) x f p fire per shot."""
    expected = expected_faults(gross.circuit)["HERALDED_ERASE"]
    assert expected < 0.6 * len(gross.herald_ids) * gross.f * gross.p
    _, _, _, fired = gross.sample(300, seed=5)
    assert np.mean([len(x) for x in fired]) == pytest.approx(expected, rel=0.05)


def test_basis_syndrome_matches_the_blind_model(gross):
    """Detector indexing: the sampled defect rate of every round agrees with the blind priors."""
    syndromes, _, _, _ = gross.sample(4000, seed=6)
    # Chance that a detector fires = chance that an odd number of its columns fire.
    H = gross.H.tocsr()
    predicted = np.array([(1 - np.prod(1 - 2 * gross.priors[H.indices[H.indptr[r]:H.indptr[r + 1]]])) / 2
                          for r in range(H.shape[0])])
    per_round = lambda v: v.reshape(gross.rounds, gross.checks).mean(axis=1)
    assert per_round(syndromes.mean(axis=0)) == pytest.approx(per_round(predicted), rel=0.05)


def test_shot_priors(gross):
    assert gross.shot_priors([]) is gross.pauli_priors
    assert (gross.pauli_priors > 0).all() and (gross.pauli_priors <= gross.priors + 1e-15).all()
    herald = next(h for h, effect in gross.herald_effects.items() if effect)
    priors = gross.shot_priors([herald])
    changed = np.flatnonzero(priors != gross.pauli_priors)
    assert list(changed) == sorted(column for column, _ in gross.herald_effects[herald])
    assert priors[changed] == pytest.approx(0.5) and priors.max() <= 0.5
    # Every flagged erasure that touches this basis flips its column with probability 1/2.
    chances = {round(chance, 9) for effect in gross.herald_effects.values() for _, chance in effect}
    assert chances == {0.5}


def test_erasure_keeps_the_fault_budget_at_fixed_p(gross):
    """SPEC.md says the total error rate is held fixed. In fault events it is, exactly: a channel of
    strength p becomes DEPOLARIZE((1-f)p) plus erasures of total strength f p, and preparation and
    measurement flips are unchanged.

    Documented finding: fewer columns flip as f grows. An erasure is I a quarter of the time and
    hits one qubit, so per qubit a two-qubit gate flips a column with chance (8/15)p at f = 0 but
    (1-f)(8/15)p + f p/4 with erasure; one-qubit channels go from (2/3)p to (1-f)(2/3)p + f p/2.
    At f = 0.5 the blind priors of one memory basis add up to about 14% less. Lower logical error
    at larger f is therefore partly less noise, not only better use of the flags."""
    no_erasure = Problem("X", 0.004)
    plain, lossy_faults = expected_faults(no_erasure.circuit), expected_faults(gross.circuit)
    assert sum(lossy_faults.values()) == pytest.approx(sum(plain.values()), rel=1e-9)
    for name in ["X_ERROR", "Z_ERROR"]:
        assert lossy_faults[name] == pytest.approx(plain[name])
    depolarizing = plain["DEPOLARIZE1"] + plain["DEPOLARIZE2"]
    assert lossy_faults["HERALDED_ERASE"] == pytest.approx(gross.f * depolarizing)
    assert 0.82 < gross.priors.sum() / no_erasure.priors.sum() < 0.89
    assert gross.pauli_priors.sum() < gross.priors.sum()


def test_flags_help_on_the_same_shots(gross):
    syndromes, other, obs, fired = gross.sample(60, seed=7)
    failures = {}
    for name in ["fast", "fast+flags"]:
        tier = build(name, gross)
        results = [tier.decode_shot(s, 0, h) for s, h in zip(syndromes, fired)]
        failures[name] = sum(((gross.L @ r.error) % 2 != o).any() for r, o in zip(results, obs))
        if name == "fast+flags":
            converged = [r for r, s in zip(results, syndromes) if r.converged]
            assert all(((gross.H @ r.error) % 2 == s).all() for r, s in zip(results, syndromes) if r.converged)
            assert len(converged) >= 55
    assert failures["fast+flags"] <= failures["fast"]
