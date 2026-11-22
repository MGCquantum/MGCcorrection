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


def shot_priors(base_priors, herald_col, fired_heralds, n_components):
    """Priors for one shot. An erasure column whose herald fired gets (merged components) x 1/4,
    e.g. 0.5 when Y and Z were merged; erasure columns whose herald did not fire get UNFLAGGED_PRIOR."""
    p = base_priors.copy()
    is_erasure = herald_col >= 0
    fired = np.isin(herald_col, fired_heralds)
    p[is_erasure & fired] = np.minimum(COMPONENT_PRIOR * n_components[is_erasure & fired], 0.75)
    p[is_erasure & ~fired] = UNFLAGGED_PRIOR
    return p
