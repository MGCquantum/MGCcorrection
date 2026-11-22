"""Environment validation: the simulation stack and both baseline decoders work end to end.

  .venv/bin/python -m pytest tests

Each test is one item of the setup checklist. They use few shots and finish in under a minute.
"""
import subprocess
import sys

import numpy as np
import pytest
import stim

import mgccorrection
from circuit import GROSS_CIRCUITS, dem_matrices, detector_ids, load_circuit, noise_strengths, sample
from decoders import bposd_decoder, per_cycle_rate, relay_decoder, score
from mgccorrection.paths import KIT, dataset_name

BASES = ["X", "Z"]


@pytest.fixture(scope="module")
def problem():
    """X memory at p = 0.002: (circuit, H, L, priors, syndromes of 40 shots, observables)."""
    circuit = load_circuit(GROSS_CIRCUITS["X"], p=0.002)
    H, L, priors = dem_matrices(circuit, "X")
    det, obs = sample(circuit, shots=40, seed=11)
    return circuit, H, L, priors, det[:, detector_ids(circuit, "X")], obs


@pytest.mark.parametrize("basis", BASES)
def test_01_stim_loads_the_gross_circuits(basis):
    circuit = stim.Circuit.from_file(GROSS_CIRCUITS[basis])
    assert (circuit.num_qubits, circuit.num_observables, circuit.num_detectors) == (288, 12, 1728)


@pytest.mark.parametrize("basis", BASES)
def test_02_memory_experiments_sample(basis):
    det, obs = sample(load_circuit(GROSS_CIRCUITS[basis], p=0.004), shots=100, seed=1)
    assert det.shape == (100, 1728) and obs.shape == (100, 12)
    assert 0.02 < det.mean() < 0.3   # noisy shots fire a few percent of the detectors


@pytest.mark.parametrize("basis", BASES)
def test_03_detector_syndromes_split_by_check_type(basis):
    circuit = load_circuit(GROSS_CIRCUITS[basis])
    own, other = detector_ids(circuit, basis), detector_ids(circuit, "Z" if basis == "X" else "X")
    assert len(own) == 13 * 72 and len(other) == 11 * 72
    assert sorted(np.concatenate([own, other])) == list(range(1728))


@pytest.mark.parametrize("basis", BASES)
def test_04_detector_error_model(basis):
    circuit = load_circuit(GROSS_CIRCUITS[basis], p=0.004)
    assert circuit.detector_error_model().num_detectors == 1728
    H, L, priors = dem_matrices(circuit, basis)
    assert H.shape == (936, 8784) and L.shape == (12, 8784) and 0 < priors.min() and priors.max() < 0.5


def test_05_bposd_initializes_and_decodes(problem):
    _, H, L, priors, syndromes, obs = problem
    failed, seconds = score(bposd_decoder(H, priors).decode, L, syndromes, obs)
    assert failed.sum() <= 1 and (seconds > 0).all()


def test_06_relay_bp_initializes_and_decodes(problem):
    _, H, L, priors, syndromes, obs = problem
    decoder = relay_decoder(H, priors)
    failed, seconds = score(decoder.decode, L, syndromes, obs)
    assert failed.sum() <= 1 and (seconds > 0).all()
    error = np.asarray(decoder.decode(syndromes[0]), np.uint8)
    assert ((H @ error) % 2 == syndromes[0]).all()   # the answer explains the syndrome


def test_07_dataset_generation(tmp_path):
    out = tmp_path / dataset_name("train", "X", 0.004)
    subprocess.run([sys.executable, "make_dataset.py", "--basis", "X", "--p", "0.004", "--shots", "50", "--seed", "1",
                    "--out", str(out)], cwd=KIT, check=True, capture_output=True)
    with np.load(out) as data:
        assert data["detectors"].shape == (50, 1728) and data["observables"].shape == (50, 12)
        assert len(data["basis_detectors"]) == 936 and float(data["p"]) == 0.004 and int(data["seed"]) == 1


def test_08_logical_observable_scoring(problem):
    _, H, L, priors, syndromes, obs = problem
    truth_free = lambda syndrome: np.zeros(H.shape[1], np.uint8)   # predicts "no observable flipped"
    failed, _ = score(truth_free, L, syndromes, obs)
    assert (failed == obs.any(axis=1)).all()
    assert per_cycle_rate(np.array([True, False, False, False]), cycles=1)[0] == pytest.approx(0.25)


def test_09_seeds_are_deterministic():
    circuit = load_circuit(GROSS_CIRCUITS["Z"], p=0.004)
    first, again, different = sample(circuit, 30, seed=5), sample(circuit, 30, seed=5), sample(circuit, 30, seed=6)
    assert (first[0] == again[0]).all() and (first[1] == again[1]).all()
    assert (first[0] != different[0]).any()


@pytest.mark.parametrize("p", mgccorrection.REQUIRED_SWEEP)
def test_10_error_rate_configuration(p):
    circuit = load_circuit(GROSS_CIRCUITS["X"], p=p)
    assert noise_strengths(circuit) == {p}
    low = sample(load_circuit(GROSS_CIRCUITS["X"], p=p / 10), 200, seed=1)[0].mean()
    assert sample(circuit, 200, seed=1)[0].mean() > 3 * low   # more noise, more detection events


def test_team_job_scripts_import():
    """The team's scripts on top of the kit load in this environment (they are not run here)."""
    import analyze, lossy, run_job  # noqa: F401,E401
