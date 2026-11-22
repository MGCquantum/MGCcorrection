"""Shared training, features and live ML-assisted BP/relay decoding.

Training accepts only seed-1 cache files; evaluation uses separate samples.
The decoder receives syndrome bits and a flag count, never logical ground truth.
The current trained router covers f=0 only (its flag-count feature is constant).
"""
from pathlib import Path
import time

import numpy as np
from ldpc import BpDecoder
from sklearn.ensemble import HistGradientBoostingClassifier

from decoders import relay_decoder

FAST_BP = {"max_iter": 200, "bp_method": "minimum_sum", "ms_scaling_factor": 1.0}


def features(d):
    return np.column_stack([d['round_weights'], d['round_weights'].sum(1), d['n_flags']])


def train_router(dirname, p):
    files = [Path(dirname) / f'train_{b}_p{p}.npz' for b in 'XZ']
    if not all(path.exists() for path in files):
        return None
    data = []
    for basis, path in zip('XZ', files):
        with np.load(path, allow_pickle=False) as source:
            d = dict(source)
        if (int(d['seed']) != 1 or str(d['basis']) != basis or
                float(d['p']) != float(p) or float(d['f']) != 0):
            raise ValueError(f'{path}: expected seed-1, f=0 training data for {basis}, p={p}')
        if d['round_weights'].shape != (int(d['shots']), 13):
            raise ValueError(f'{path}: invalid training feature shape')
        data.append(d)
    X = np.vstack([features(d) for d in data])
    y = np.concatenate([d['conv_bp'] for d in data]).astype(bool)
    model = HistGradientBoostingClassifier(max_iter=200, random_state=0).fit(X, y)
    w = X[:, -2]
    thresholds = np.unique(w)
    acc = [((w <= t) == y).mean() for t in thresholds]
    return model, thresholds[int(np.argmax(acc))]


class HybridDecoder:
    """Live inference matching analyze.policies; returns an error-mechanism vector."""
    def __init__(self, H, priors, router):
        self.router = router
        self.bp = BpDecoder(H, error_channel=list(priors), **FAST_BP)
        self.relay = relay_decoder(H, priors)
        self.last = {}

    def decode(self, syndrome):
        syndrome = np.asarray(syndrome, dtype=np.uint8)
        weights = syndrome.reshape(-1, 72).sum(1)
        x = features({'round_weights': weights[None, :], 'n_flags': np.zeros(1)})
        start = time.perf_counter()
        easy = bool(self.router.predict(x)[0])
        self.last = {'router_s': time.perf_counter() - start, 'bp_s': 0., 'relay_s': 0., 'easy': easy}
        if easy:
            start = time.perf_counter()
            e = self.bp.decode(syndrome)
            self.last['bp_s'] = time.perf_counter() - start
        escalated = not easy or not self.bp.converge
        if escalated:
            start = time.perf_counter()
            e = self.relay.decode(syndrome)
            self.last['relay_s'] = time.perf_counter() - start
        self.last['escalated'] = escalated
        return np.asarray(e, np.uint8)
