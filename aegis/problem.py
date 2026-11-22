"""One memory experiment as a decoding problem, with optional heralded erasure.

Without erasure (f = 0) this is exactly the kit's problem: its circuit, its sampler and its
matrices H, L and priors.

With erasure (f > 0) the circuit comes from the team's lossy.lossy_circuit: a fraction f of every
depolarizing channel becomes HERALDED_ERASE, and each herald is a detector with coordinate 2.
Two sets of priors exist for the same matrix H:

  blind priors   the erasures are averaged in as ordinary errors (herald flags ignored)
  shot priors    priors given the flags of one shot (herald flags used)

Shot priors follow from the circuit's detector error model. Given that herald h fired, the erased
qubit carries I, X, Y or Z with probability 1/4 each. Stim lists the possible effects of that
erasure as error components that all contain h. The chance of one effect, given the flag, is its
component probability divided by the sum over all components of h. For the detectors of one
memory basis the two Paulis that anticommute with the checks have the same effect, so a flagged
erasure flips its column of H with probability 1/2. A herald that did not fire rules its
erasure out, which leaves the Pauli-only priors.
"""
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
import stim

from circuit import GROSS_CIRCUITS, _incidence_matrix, dem_matrices, detector_ids, load_circuit
from lossy import herald_ids, lossy_circuit


def xor_probability(p, q):
    """Probability that exactly one of two independent events happens."""
    return p * (1 - q) + q * (1 - p)


def erasure_model(circuit, det_ids, heralds):
    """(H, L, blind priors, Pauli-only priors, herald effects) of a circuit with herald detectors.

    det_ids are the detectors to decode and heralds the detector ids of the herald flags.
    herald effects: {herald: [(column of H, chance that the column flipped given the flag)]}.
    """
    rows = {int(d): k for k, d in enumerate(det_ids)}
    heralds = set(int(h) for h in heralds)
    columns, blind, pauli = {}, [], []
    components = defaultdict(lambda: defaultdict(float))   # herald -> column (or -1: no effect) -> probability
    dem = circuit.detector_error_model(approximate_disjoint_errors=True).flattened()
    for instruction in dem:
        if instruction.type != "error":
            continue
        targets, q = instruction.targets_copy(), instruction.args_copy()[0]
        flagged = [t.val for t in targets if t.is_relative_detector_id() and t.val in heralds]
        effect = (tuple(sorted(rows[t.val] for t in targets if t.is_relative_detector_id() and t.val in rows)),
                  tuple(sorted(t.val for t in targets if t.is_logical_observable_id())))
        if len(flagged) > 1:
            raise ValueError("an error component carries two heralds; the erasure model assumes one")
        column = -1
        if effect != ((), ()):
            column = columns.setdefault(effect, len(columns))
            if column == len(blind):
                blind.append(0.0)
                pauli.append(0.0)
            blind[column] = xor_probability(blind[column], q)
            if not flagged:
                pauli[column] = xor_probability(pauli[column], q)
        if flagged:
            components[flagged[0]][column] += q
    effects = list(columns)
    H = _incidence_matrix([e[0] for e in effects], len(det_ids))
    L = _incidence_matrix([e[1] for e in effects], circuit.num_observables).tocsr()
    herald_effects = {herald: [(column, q / sum(parts.values())) for column, q in parts.items() if column >= 0]
                      for herald, parts in components.items()}
    return H, L, np.array(blind), np.array(pauli), herald_effects


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
        det_ids = detector_ids(self.circuit, self.basis)
        self.herald_ids = herald_ids(self.circuit)
        self.H, self.L, self.priors, self.pauli_priors, self.herald_effects = erasure_model(self.circuit, det_ids, self.herald_ids)

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
