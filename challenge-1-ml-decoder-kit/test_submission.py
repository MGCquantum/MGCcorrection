"""Regressions for same-shot merges, leakage guards, and live/cached routing parity."""
import numpy as np
import pytest
from threadpoolctl import threadpool_limits

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


def test_z_partner_is_a_fixed_derangement():
    from analyze import z_partner
    j = z_partner(1000)
    assert sorted(j) == list(range(1000)) and not (j == np.arange(1000)).any()
    assert np.array_equal(j, z_partner(1000))


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


def test_run_job_records_do_not_depend_on_worker_count(tmp_path):
    """Fixed chunks with relay-BP restarted per chunk: the same seed gives the same record with any --workers."""
    import subprocess, sys
    out = {}
    for workers in (1, 3):
        path = tmp_path / f"w{workers}.npz"
        subprocess.run([sys.executable, "run_job.py", "--basis", "X", "--p", "0.005", "--shots", "12", "--seed", "7",
                        "--decoders", "bp", "relay", "--workers", str(workers), "--chunk", "4", "--out", str(path)],
                       check=True, capture_output=True)
        out[workers] = dict(np.load(path))
    for key in ("sample_sha256", "round_weights", "fail_bp", "conv_bp", "fail_relay", "conv_relay"):
        assert np.array_equal(out[1][key], out[3][key]), key


def test_run_job_chunk_ignores_what_the_worker_decoded_before():
    """relay-BP's random stream runs on between shots; run_job.work rebuilds it at every chunk."""
    import stim
    import run_job
    from circuit import GROSS_CIRCUITS, detector_ids, load_circuit, sample
    circuit = load_circuit(GROSS_CIRCUITS["X"], 0.006)
    det, obs = sample(circuit, 12, 3)
    syn = det[:, detector_ids(circuit, "X")]
    job = lambda lo, hi: (str(circuit), "X", ["relay"], syn[lo:hi], obs[lo:hi], [np.array([], int)] * (hi - lo))
    first = run_job.work(job(0, 6))["relay"]
    run_job.work(job(6, 12))
    again = run_job.work(job(0, 6))["relay"]
    assert np.array_equal(first[0], again[0]) and np.array_equal(first[2], again[2])
    assert run_job.chunk_bounds(10, 4) == [(0, 4), (4, 8), (8, 10)]


def test_timing_window_flags_spread_one_loss_over_its_qubit():
    from lossy import timing_window_flags
    hq = np.array([0, 1, 0, 1, 0, 1, 0, 1])          # qubit of each herald, in time order
    keys, w = timing_window_flags(np.array([4]), hq, 3, np.random.default_rng(1))
    assert len(keys) == 3 and 4 in keys and set(hq[keys]) == {0} and np.allclose(w, 1 / 3)
    keys, w = timing_window_flags(np.array([4]), hq, 1, np.random.default_rng(1))
    assert list(keys) == [4] and np.allclose(w, 1)
