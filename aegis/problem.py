"""One memory experiment as a decoding problem, with optional heralded erasure.

Without erasure (f = 0) this is exactly the kit's problem: its circuit, its sampler and its
matrices H, L and priors.

With erasure (f > 0) everything comes from the team's corrected lossy.py, so there is one
implementation of the erasure model in the repository: lossy.lossy_circuit turns a fraction f of
every depolarizing channel into HERALDED_ERASE (each herald is a detector with coordinate 2),
lossy.blind_matrices gives H, L and the flag-blind priors, and lossy.aware_matrices gives the
herald-conditioned components. Two sets of priors exist for the same matrix H:

  blind priors   the erasures are averaged in as ordinary errors (herald flags ignored)
  shot priors    priors given the flags of one shot (herald flags used)

Given that herald h fired, the erased qubit carries I, X, Y or Z with probability 1/4 each.
lossy.aware_matrices recovers how many of those Pauli components share each effect from the
probability mass (not by counting error-model entries, which Stim may already have merged), so a
flagged erasure flips a column of one memory basis with probability 1/2 when the two Paulis that
anticommute with its checks have that effect. A herald that did not fire rules its erasure out,
which leaves the Pauli-only priors. On the same shot this gives the same priors as
lossy.fold_priors(lossy.shot_priors(...)) up to lossy.UNFLAGGED_PRIOR (tests/test_loss.py).
"""
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
import stim

import lossy
from circuit import GROSS_CIRCUITS, dem_matrices, detector_ids, load_circuit
from lossy import herald_ids, lossy_circuit


def xor_probability(p, q):
    """Probability that exactly one of two independent events happens."""
    return p * (1 - q) + q * (1 - p)


def erasure_model(circuit, basis):
    """(H, L, blind priors, Pauli-only priors, herald effects) of a circuit with herald detectors,
    built from lossy.py for the detectors of one memory basis.

    herald effects: {herald detector id: [(column of H, chance that the column flipped given the flag)]}.
    """
    H, L, blind = lossy.blind_matrices(circuit, basis)
    aware_H, aware_L, aware_priors, herald_col, n_components = lossy.aware_matrices(circuit, basis)
    column = lossy.blind_column_map((H, L), (aware_H, aware_L))
    if (column < 0).any():
        raise ValueError("an erasure-aware column has no flag-blind counterpart")
    ordinary = herald_col < 0
    if len(np.unique(column[ordinary])) != int(ordinary.sum()):
        raise ValueError("two ordinary aware columns share one effect")
    pauli = np.zeros(H.shape[1])
    pauli[column[ordinary]] = aware_priors[ordinary]
    effects = defaultdict(list)
    for j in np.flatnonzero(~ordinary):
        chance = min(lossy.COMPONENT_PRIOR * int(n_components[j]), 0.75)
        effects[int(herald_col[j])].append((int(column[j]), chance))
    return H, L, blind, pauli, dict(effects)


@dataclass
class Problem:
    basis: str
    p: float
    f: float = 0.0                        # fraction of depolarizing noise turned into heralded erasure
    circuit_path: str | None = None       # default: the kit's Gross code circuit of this basis
    circuit: stim.Circuit = field(init=False, repr=False)

    def __post_init__(self):
        base = load_circuit(self.circuit_path or GROSS_CIRCUITS[self.basis])
        if self.f:
            self.circuit = lossy_circuit(base, self.p, self.f)
            self._erasure_matrices()
        else:
            self.circuit = load_circuit(self.circuit_path or GROSS_CIRCUITS[self.basis], self.p)
            self.H, self.L, self.priors = dem_matrices(self.circuit, self.basis)
            self.pauli_priors, self.herald_ids, self.herald_effects = self.priors, np.zeros(0, int), {}
        self.det_ids = detector_ids(self.circuit, self.basis)
        self.other_ids = detector_ids(self.circuit, "Z" if self.basis == "X" else "X")
        self.rounds = len(self.det_ids) // self.checks
        self.H = self.H.tocsc()

    @property
    def checks(self):
        """Checks of one type: half the measured qubits, which are half of all qubits."""
        return self.circuit.num_qubits // 4

    def _erasure_matrices(self):
        self.herald_ids = herald_ids(self.circuit)
        self.H, self.L, self.priors, self.pauli_priors, self.herald_effects = erasure_model(self.circuit, self.basis)

    def shot_priors(self, fired):
        """Priors of one shot given the heralds that fired (detector ids)."""
        if len(fired) == 0:
            return self.pauli_priors
        priors = self.pauli_priors.copy()
        for herald in fired:
            for column, chance in self.herald_effects.get(int(herald), ()):
                priors[column] = xor_probability(priors[column], chance)
        return np.minimum(priors, 0.5)

    def herald_columns(self, fired):
        """Columns of H that the fired heralds can flip."""
        return np.array([column for herald in fired for column, _ in self.herald_effects.get(int(herald), ())], int)

    def sample(self, shots, seed):
        """(syndromes, other, observables, fired).

        syndromes: detectors of the memory basis. other: detectors of the other check type.
        fired: per shot, the detector ids of the heralds that fired.
        """
        det, obs = self.circuit.compile_detector_sampler(seed=seed).sample(shots, separate_observables=True)
        det, obs = det.astype(np.uint8), obs.astype(np.uint8)
        fired = [self.herald_ids[det[k, self.herald_ids] == 1] for k in range(shots)] if len(self.herald_ids) \
            else [np.zeros(0, int)] * shots
        return np.ascontiguousarray(det[:, self.det_ids]), np.ascontiguousarray(det[:, self.other_ids]), obs, fired
