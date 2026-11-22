"""Heralded erasure (detected atom loss) for the kit's memory circuits, and erasure-aware decoding matrices.

Model (idealized heralded erasure): every depolarizing channel of strength p becomes
    DEPOLARIZE((1 - f) p)  +  HERALDED_ERASE on its qubits,
with erasure probability f p per qubit for one-qubit channels and f p / 2 per qubit for two-qubit
channels, so the expected number of fault events per gate stays about p for every f.
Heralds fire at the gate with the exact location; real atom loss is detected later (stated as a caveat).
Preparation and measurement flips (X_ERROR, Z_ERROR) are unchanged.

Each herald is recorded as a detector with coordinate 2, so the kit's detector_ids(circuit, "X"/"Z")
ignores it and the baselines see exactly the usual syndrome.
"""
import numpy as np
import stim

from circuit import _incidence_matrix, _merge_duplicates, _row_numbers, _replace_noise, detector_ids

HERALD_COORD = 2.0
COMPONENT_PRIOR = 0.25   # given a fired herald, each Pauli component (I, X, Y, Z) has probability 1/4
UNFLAGGED_PRIOR = 1e-9   # erasure components whose herald did not fire cannot have happened


def lossy_circuit(circuit, p, f):
    """Copy of the kit circuit at noise strength p with a fraction f of depolarizing noise turned into heralded erasure."""
    base = _replace_noise(circuit, p).flattened()
    if f == 0:
        return base
    out = stim.Circuit()
    remap = {}            # absolute measurement index in the base circuit -> index in the new circuit
    n_old = n_new = 0
    for ins in base:
        name, targets, args = ins.name, ins.targets_copy(), ins.gate_args_copy()
        if name in ("DETECTOR", "OBSERVABLE_INCLUDE"):
            new_targets = [stim.target_rec(remap[n_old + t.value] - n_new) if t.is_measurement_record_target else t
                           for t in targets]
            out.append(name, new_targets, args)
            continue
        if name in ("DEPOLARIZE1", "DEPOLARIZE2"):
            out.append(name, targets, [(1 - f) * args[0]])
            qubits = [t.value for t in targets]
            q = f * args[0] / (2 if name == "DEPOLARIZE2" else 1)
            out.append("HERALDED_ERASE", qubits, [q])
            for k in range(len(qubits)):
                out.append("DETECTOR", [stim.target_rec(-len(qubits) + k)], [HERALD_COORD])
            n_new += len(qubits)
            continue
        out.append(ins)
        if stim.gate_data(name).produces_measurements:
            for _ in [t for t in targets if t.is_qubit_target]:
                remap[n_old] = n_new
                n_old += 1
                n_new += 1
    return out


def herald_ids(circuit):
    """Detector ids of the heralds, in detector order."""
    coords = circuit.get_detector_coordinates()
    return np.array([d for d in range(circuit.num_detectors) if coords[d] == [HERALD_COORD]], dtype=int)


def dem(circuit):
    return circuit.detector_error_model(approximate_disjoint_errors=True).flattened()


def blind_matrices(circuit, basis):
    """H, L, priors that ignore the heralds (erasure components are merged into ordinary errors)."""
    det_ids = detector_ids(circuit, basis)
    errors = _merge_duplicates(dem(circuit), _row_numbers(det_ids))
    dets, obs = zip(*errors)
    return (_incidence_matrix(dets, len(det_ids)), _incidence_matrix(obs, circuit.num_observables).tocsr(),
            np.array(list(errors.values())))


def _herald_probabilities(circuit):
    """Map herald detector IDs to the probability of their HERALDED_ERASE event."""
    records, probabilities = {}, {}
    measurements = detector = 0
    for ins in circuit.flattened():
        if ins.name == "HERALDED_ERASE":
            for offset in range(len(ins.targets_copy())):
                records[measurements + offset] = ins.gate_args_copy()[0]
        if ins.name == "DETECTOR":
            if ins.gate_args_copy() == [HERALD_COORD]:
                targets = ins.targets_copy()
                if len(targets) != 1 or not targets[0].is_measurement_record_target:
                    raise ValueError("Expected a single-record herald detector")
                probabilities[detector] = records[measurements + targets[0].value]
            detector += 1
        if stim.gate_data(ins.name).produces_measurements:
            measurements += stim.Circuit(str(ins)).num_measurements
    return probabilities


def aware_matrices(circuit, basis):
    """H, L, base priors, per column the herald detector that marks it (-1 for ordinary errors),
    and per column how many Pauli components were merged into it (e.g. Y and Z look identical to X checks).

    Ordinary errors are merged as in the kit. Erasure components keep their own column so a
    fired herald can raise exactly their prior.
    """
    det_rows = _row_numbers(detector_ids(circuit, basis))
    herald_probabilities = _herald_probabilities(circuit)
    heralds = set(herald_probabilities)
    merged, count = {}, {}
    for e in dem(circuit):
        if e.type != "error":
            continue
        t = e.targets_copy()
        h = [x.val for x in t if x.is_relative_detector_id() and x.val in heralds]
        d = tuple(sorted(det_rows[x.val] for x in t if x.is_relative_detector_id() and x.val in det_rows))
        o = tuple(sorted(x.val for x in t if x.is_logical_observable_id()))
        if not d and not o:
            continue
        key = (d, o, h[0] if h else -1)
        q = e.args_copy()[0]
        old = merged.get(key, 0.0)
        if h:
            # Pauli outcomes of one heralded erasure are mutually exclusive.
            # Stim may already merge equal outcomes (e.g. X and Y => q/2), so
            # counting DEM instructions would incorrectly assign prior 1/4.
            components = 4 * q / herald_probabilities[h[0]]
            if not np.isclose(components, round(components)):
                raise ValueError("Herald mechanism is not an integral Pauli component count")
            merged[key] = old + q
            count[key] = count.get(key, 0) + round(components)
        else:
            merged[key] = q * (1 - old) + old * (1 - q)
            count[key] = count.get(key, 0) + 1
    keys = list(merged)
    H = _incidence_matrix([k[0] for k in keys], len(det_rows))
    L = _incidence_matrix([k[1] for k in keys], circuit.num_observables).tocsr()
    return (H, L, np.array([merged[k] for k in keys]), np.array([k[2] for k in keys]),
            np.array([count[k] for k in keys]))


def shot_priors(base_priors, herald_col, fired_heralds, n_components, weights=None):
    """Priors for one shot. An erasure column whose herald fired gets (merged components) x 1/4,
    e.g. 0.5 when Y and Z were merged; erasure columns whose herald did not fire get UNFLAGGED_PRIOR.

    weights (optional, same length as fired_heralds): probability that each flagged location really
    was erased, for flags whose timing is uncertain; the flagged priors are scaled by it."""
    p = base_priors.copy()
    is_erasure = herald_col >= 0
    fired = np.isin(herald_col, fired_heralds)
    full = np.minimum(COMPONENT_PRIOR * n_components[is_erasure & fired], 0.75)
    if weights is not None:
        w = dict(zip(np.asarray(fired_heralds).tolist(), np.asarray(weights, float).tolist()))
        full = full * np.array([w[h] for h in herald_col[is_erasure & fired]])
        full = np.maximum(full, UNFLAGGED_PRIOR)
    p[is_erasure & fired] = full
    p[is_erasure & ~fired] = UNFLAGGED_PRIOR
    return p


def herald_qubits(circuit):
    """Qubit of each herald, in herald (detector) order: each HERALDED_ERASE target is followed by its herald."""
    return np.array([t.value for ins in circuit.flattened() if ins.name == "HERALDED_ERASE"
                     for t in ins.targets_copy()], dtype=int)


def timing_window_flags(fired, herald_qubit, window, rng):
    """Flags whose timing is uncertain: the decoder learns the lost qubit and a window of `window`
    consecutive erasure opportunities on that qubit that contains the true one (true position uniform
    in the window). Returns (flagged herald positions, probability each was the erased one).

    fired holds herald positions (0..n_heralds-1), not detector ids."""
    if window <= 1 or len(fired) == 0:
        return np.asarray(fired, int), np.ones(len(fired))
    weight = {}
    for h in fired:
        slots = np.flatnonzero(herald_qubit == herald_qubit[h])          # this qubit's opportunities, in time order
        i = int(np.searchsorted(slots, h))
        start = min(max(i - int(rng.integers(window)), 0), max(len(slots) - window, 0))
        for s in slots[start:start + window]:
            weight[int(s)] = min(weight.get(int(s), 0.0) + 1.0 / min(window, len(slots)), 1.0)
    keys = np.array(sorted(weight), int)
    return keys, np.array([weight[k] for k in keys])


def blind_column_map(blind, aware):
    """For each flag-aware column, the flag-blind column with the same detectors and observables.

    blind and aware are (H, L) pairs. Every aware column is an erasure component or an ordinary
    error whose signature also appears in the blind matrix, so the result has no -1 entries.
    """
    def signatures(H, L):
        H, L = H.tocsc(), L.tocsc()
        return [(tuple(H.indices[H.indptr[j]:H.indptr[j + 1]]), tuple(L.indices[L.indptr[j]:L.indptr[j + 1]]))
                for j in range(H.shape[1])]
    index = {s: j for j, s in enumerate(signatures(*blind))}
    return np.array([index.get(s, -1) for s in signatures(*aware)])


def fold_priors(aware_priors, column_map, n_blind):
    """Per-shot aware priors folded onto the blind columns.

    Aware columns that share a blind column have identical detector/observable effects, and two
    occurrences cancel, so independent contributions combine by parity: (1 - prod(1 - 2q)) / 2.
    A flagged effect that is equally likely present or absent stays at exactly 0.5.
    """
    keep = column_map >= 0
    product = np.ones(n_blind)
    np.multiply.at(product, column_map[keep], 1 - 2 * np.asarray(aware_priors, float)[keep])
    return np.clip((1 - product) / 2, 1e-12, 0.5)
