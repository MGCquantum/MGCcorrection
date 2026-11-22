"""Regressions for same-shot merges, leakage guards, and live/cached routing parity."""
from pathlib import Path

import numpy as np
import pytest

from analyze import load, policies
from audit_submission import validate_cache
from hybrid import HybridDecoder, train_router


def cache(n=3):
    return dict(p=np.array(.004), f=np.array(0.), basis=np.array('X'), seed=np.array(2), shots=np.array(n),
                round_weights=np.zeros((n,13)), n_flags=np.zeros(n),
                fail_bp=np.array([False,True,False]), time_bp=np.ones(n), conv_bp=np.array([True,False,True]),
                fail_relay=np.array([False,False,True]), time_relay=np.ones(n)*2, conv_relay=np.ones(n,bool))


def test_different_full_sample_hash_cannot_merge_partial_decoder(tmp_path):
    d=cache(); d['sample_sha256']=np.array('old')
    np.savez(tmp_path/'test_X_p0.004.npz', **d)
    extra={k:v for k,v in d.items() if not k.startswith(('fail_','time_','conv_'))}
    extra.update(sample_sha256=np.array('new'), fail_bposd=np.zeros(3,bool))
    np.savez(tmp_path/'extra_X_p0.004.npz', **extra)
    with pytest.raises(ValueError, match='different shots'):
        load(str(tmp_path/'test_X_p0.004.npz'))


def test_complete_rerun_replaces_all_features_and_decoders(tmp_path):
    d=cache(); d['sample_sha256']=np.array('old')
    np.savez(tmp_path/'test_X_p0.004.npz', **d)
    e=cache(); e.update(sample_sha256=np.array('new'), round_weights=np.ones((3,13)), fail_bp=np.ones(3,bool))
    np.savez(tmp_path/'extra_X_p0.004.npz', **e)
    got=load(str(tmp_path/'test_X_p0.004.npz'))
    assert got['fail_bp'].all() and got['round_weights'].all()


def test_corrupt_cache_rejected():
    d=cache(); d['time_bp']=np.array([float('nan')]*3)
    with pytest.raises(ValueError, match='invalid decoder timings'): validate_cache(d,'broken')
    d=cache(); d['round_weights'][0,0] = float('nan')
    with pytest.raises(ValueError, match='invalid count features'): validate_cache(d,'broken')
    d=cache(); d['fail_relay']=np.array([False])
    with pytest.raises(ValueError, match='length'): validate_cache(d,'broken')


def test_training_rejects_test_seed(tmp_path):
    for b in 'XZ':
        d=cache(); d['basis']=np.array(b)
        np.savez(tmp_path/f'train_{b}_p0.004.npz', **d)
    with pytest.raises(ValueError, match='seed-1'):
        train_router(tmp_path,.004)


@pytest.mark.parametrize('easy,converged', [(True,True),(True,False),(False,True)])
def test_live_and_cached_policy_agree(easy,converged):
    class Router:
        def predict(self,x): return np.full(len(x),easy)
    class Decoder:
        def __init__(self, value): self.value=value; self.calls=0; self.converge=converged
        def decode(self,s): self.calls+=1; return np.array([self.value],np.uint8)
    live=HybridDecoder.__new__(HybridDecoder)
    live.router=Router(); live.bp=Decoder(1); live.relay=Decoder(0)
    answer=live.decode(np.zeros(936,np.uint8))
    d=cache(); d['fail_bp']=np.ones(3,bool); d['fail_relay']=np.zeros(3,bool); d['conv_bp']=np.full(3,converged)
    cached=policies(d,(Router(),0))['hybrid_ml'][0]
    assert bool(answer[0]) == bool(cached[0])
    assert live.bp.calls == int(easy)
    assert live.relay.calls == int(not easy or not converged)


def test_zero_erasure_preserves_original_circuit():
    from circuit import GROSS_CIRCUITS, load_circuit
    from lossy import lossy_circuit
    for basis in 'XZ':
        base=load_circuit(GROSS_CIRCUITS[basis], .004)
        assert lossy_circuit(base,.004,0) == base.flattened()


def test_herald_flags_and_conditioned_priors():
    import stim
    from lossy import lossy_circuit, herald_ids, aware_matrices, shot_priors, UNFLAGGED_PRIOR
    c=lossy_circuit(stim.Circuit('R 0\nDEPOLARIZE1(0.2) 0\nM 0\nDETECTOR(0) rec[-1]\nOBSERVABLE_INCLUDE(0) rec[-1]'),.2,1)
    det,obs=c.compile_detector_sampler(seed=88).sample(2000,separate_observables=True)
    flags=det[:,herald_ids(c)].any(axis=1)
    assert not obs[~flags].any()
    assert .3 < obs[flags].mean() < .7
    H,L,p,hc,nc=aware_matrices(c,'X')
    unfired=shot_priors(p,hc,[],nc)
    fired=shot_priors(p,hc,herald_ids(c),nc)
    assert np.all(unfired[hc>=0] == UNFLAGGED_PRIOR)
    assert np.allclose(fired[hc>=0], .5)


def test_fold_priors_uses_parity_and_keeps_half():
    from lossy import fold_priors
    m = np.array([0, 0, 1, 1, 2, 2])
    q = np.array([0.1, 0.2, 0.5, 0.3, 0.3, 0.3])
    out = fold_priors(q, m, 3)
    assert np.allclose(out, [0.1 * 0.8 + 0.2 * 0.9, 0.5, 0.3 * 0.7 * 2])


def test_independent_pairs_use_each_index_once():
    from analyze import independent_pairs
    for n in (2, 3, 1000, 1001):
        ix, iz = independent_pairs(n)
        assert len(ix) == len(iz) == n // 2
        assert len(set(ix) | set(iz)) == 2 * (n // 2)          # disjoint: no index in two pairs
        assert np.array_equal(ix, independent_pairs(n)[0])     # fixed
    with pytest.raises(ValueError):
        independent_pairs(1)


def test_independent_pairs_give_binomial_variance():
    """Fully correlated X_k = Z_k: failure counts must still have binomial variance."""
    from analyze import pair_arrays
    rng = np.random.default_rng(0)
    counts = []
    for _ in range(4000):
        x = rng.random(200) < 0.05
        pol = {'d': (x, np.zeros(200))}
        counts.append(pair_arrays(pol, pol, 'd')[0].sum())
    q = 1 - 0.95 ** 2
    assert abs(np.var(counts) / (100 * q * (1 - q)) - 1) < 0.15


def test_paired_refuses_mismatched_shapes():
    from analyze import paired
    px = {'d': (np.array([True]), np.array([1.]))}
    pz = {'d': (np.array([False, False, True]), np.array([1., 1., 1.]))}
    with pytest.raises(ValueError):
        paired(px, pz, 'd')


def test_analysis_rejects_mislabelled_records():
    from analyze import check_conditions
    d = {'basis': np.array('X'), 'p': np.array(0.005), 'f': np.array(0.0)}
    with pytest.raises(ValueError):
        check_conditions(d, 'test_X_p0.004.npz', 'X', '0.004')


def _copy_relay_results(tmp_path):
    import shutil
    for path in Path(__file__).parent.joinpath('results_v2').glob('*.npz'):
        shutil.copy(path, tmp_path / path.name)
    return tmp_path


def test_audit_fails_when_a_relay_seed_loses_a_basis(tmp_path):
    from audit_submission import audit
    d = _copy_relay_results(tmp_path)
    (d / 'erase4_Z_p0.004_f0.5_s32.npz').unlink()
    report = audit(d)
    assert not report['passed']
    failed = [c['check'] for c in report['checks'] if not c['pass']]
    assert any('both X and Z' in c for c in failed) and any('p=0.004 f=0.5: complete X/Z records for every expected seed' in c for c in failed)


def test_strict_grouping_rejects_orphan_z_file(tmp_path):
    from analyze import relay_flag_groups
    d = _copy_relay_results(tmp_path)
    (d / 'erase4_X_p0.005_f0.5_s31.npz').unlink()
    with pytest.raises(ValueError):
        relay_flag_groups(str(d), strict=True)
    assert ('0.005', '0.5') not in relay_flag_groups(str(d))


def test_sampler_seeds_are_stable_and_distinct_across_the_manifest():
    from run_job import sampler_seed
    seeds = {}
    for root, split in [(1, 'train'), (2, 'test'), (31, 'test'), (32, 'test'), (33, 'test')]:
        for basis in 'XZ':
            for p in (.003, .004, .005):
                for f in (0, .25, .5, .75):
                    seeds[(root, split, basis, p, f)] = sampler_seed(root, split, basis, p, f)
    assert len(set(seeds.values())) == len(seeds)
    assert all(0 <= s < 2 ** 64 for s in seeds.values())
    assert sampler_seed(2, 'test', 'X', .004, 0) == seeds[(2, 'test', 'X', .004, 0)]
    assert sampler_seed(2, 'test', 'X', .004, 0, 'legacy') == 2


def test_direct_pairing_for_independent_streams():
    from analyze import pair_arrays, pairing_for
    def rec(basis, s):
        return {'seed': np.array(2), 'split': np.array('test'), 'seed_scheme': np.array('ss-v1'),
                'sampler_seed': np.uint64(s), 'basis': np.array(basis)}
    assert pairing_for(rec('X', 10), rec('Z', 11)) == 'direct'
    with pytest.raises(ValueError):
        pairing_for(rec('X', 10), rec('Z', 10))
    with pytest.raises(ValueError):
        pairing_for(rec('X', 10), {'seed': np.array(2)})
    assert pairing_for({'seed': np.array(2)}, {'seed': np.array(2)}) == 'disjoint'
    px = {'d': (np.array([1, 0, 0, 0], bool), np.array([1., 2., 3., 4.]) / 1e3)}
    pz = {'d': (np.array([0, 0, 1, 0], bool), np.array([10., 20., 30., 40.]) / 1e3)}
    failed, ms = pair_arrays(px, pz, 'd', 'direct')
    assert failed.tolist() == [True, False, True, False] and np.allclose(ms, [11, 22, 33, 44])


@pytest.fixture(scope='module')
def gross_x():
    from circuit import GROSS_CIRCUITS, dem_matrices, load_circuit
    return dem_matrices(load_circuit(GROSS_CIRCUITS['X'], .004), 'X')


class _FixedRouter:
    def __init__(self, easy): self.easy = easy
    def predict(self, x): return np.full(len(x), self.easy)


@pytest.mark.parametrize('easy', [True, False])
def test_real_live_hybrid_decodes_zero_and_single_fault(gross_x, easy):
    """Real fast-BP and relay-BP paths, deterministic inputs, asserted answers."""
    H, L, priors = gross_x
    live = HybridDecoder(H, priors, _FixedRouter(easy))
    e = live.decode(np.zeros(H.shape[0], np.uint8))
    assert not ((L @ e) % 2).any() and live.last['easy'] == easy and live.last['escalated'] == (not easy)
    col = int(np.argmax(np.asarray(H.sum(0)).ravel()))
    syndrome = np.asarray(H[:, col].todense()).ravel().astype(np.uint8)
    e = live.decode(syndrome)
    assert np.array_equal((H @ e) % 2, syndrome)
    assert np.array_equal((L @ e) % 2, np.asarray(L[:, col].todense()).ravel() % 2)


def test_real_live_hybrid_falls_back_to_relay(gross_x):
    H, L, priors = gross_x
    live = HybridDecoder(H, priors, _FixedRouter(True))
    class NotConverged:
        converge = False
        def decode(self, s): return np.ones(H.shape[1], np.uint8)   # a wrong answer that must be discarded
    live.bp = NotConverged()
    e = live.decode(np.zeros(H.shape[0], np.uint8))
    assert live.last['escalated'] and not e.any()


def test_analysis_plot_includes_every_experiment(tmp_path, monkeypatch):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import analyze
    row = dict(rate_per_cycle=1e-4, ci_low=5e-5, ci_high=2e-4, failed_pairs=3, pairs=1000, mean_ms=1., p99_ms=2.)
    rows = [dict(row, experiment='sweep', p='0.004', f=0, decoder='relay'),
            dict(row, experiment='erasure', p='0.004', f='0.5', decoder='bposd'),
            dict(row, experiment='erasure_relay', p='0.004', f='0.5', decoder='relay'),
            dict(row, experiment='erasure_relay', p='0.004', f='0.5', decoder='relay_flags')]
    seen = {}
    monkeypatch.setattr(plt.Figure, 'savefig', lambda self, *a, **k: seen.update(
        titles=[ax.get_title() for ax in self.axes], series=[len(ax.containers) for ax in self.axes]))
    analyze.plot(rows, str(tmp_path))
    assert 'relay-BP: using erasure flags' in seen['titles']
    assert all(n > 0 for t, n in zip(seen['titles'], seen['series']) if t != 'Speed')
