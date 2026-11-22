"""Tests of the QEC-Aegis decoder: tiers, features, risk model, routing policy and caching."""
import inspect

import joblib
import numpy as np
import pytest

from aegis import TEST_SEED, TRAIN_SEED, VAL_SEED, collect, features, policy
from aegis.decoder import AegisDecoder, better
from aegis.model import CONVERGED, RiskModel, calibrate, quality, train
from aegis.problem import Problem
from aegis.tiers import TierResult, build
from circuit import GROSS_CIRCUITS, load_circuit, sample


@pytest.fixture(scope="module")
def problem():
    return Problem("X", 0.004)


@pytest.fixture(scope="module")
def shots(problem):
    return problem.sample(24, seed=9)


@pytest.fixture(scope="module")
def tier1_results(problem, shots):
    tier = build("fast", problem)
    return [tier.decode_shot(s, int(o.sum()), ()) for s, o in zip(shots[0], shots[1])]


def constant_model(risk):
    """Model whose calibrated risk is the same for every converged shot."""
    logit = np.log(risk / (1 - risk))
    return RiskModel("logistic", [1], coef=np.zeros(1), mean=np.zeros(1), scale=np.ones(1), intercept=logit)


def synthetic(n, seed):
    """Feature rows whose label depends on two features, with noise."""
    rng = np.random.default_rng(seed)
    F = rng.normal(size=(n, len(features.NAMES))).astype(np.float32)
    F[:, CONVERGED] = 1
    y = F[:, features.NAMES.index("solution_weight")] + 0.5 * F[:, features.NAMES.index("log_iterations")] \
        + rng.normal(scale=0.3, size=n) > 1.5
    return F, y


# ---- problem and tiers ------------------------------------------------------------------

def test_problem_without_erasure_is_the_kit_problem(problem):
    syndromes, other, obs, fired = problem.sample(20, seed=3)
    det, kit_obs = sample(load_circuit(GROSS_CIRCUITS["X"], 0.004), 20, 3)
    assert (syndromes == det[:, problem.det_ids]).all() and (obs == kit_obs).all()
    assert other.shape == (20, 792) and all(len(x) == 0 for x in fired)
    assert (problem.rounds, problem.checks) == (13, 72)


@pytest.mark.parametrize("name", ["bposd", "relay", "fast", "strong10", "bp30"])
def test_tier_output(problem, shots, name):
    """Dimensions, GF(2) parity of converged answers, and the reported weight."""
    tier = build(name, problem)
    for syndrome in shots[0][:4]:
        result = tier.decode_shot(syndrome)
        assert result.error.shape == (problem.H.shape[1],) and set(np.unique(result.error)) <= {0, 1}
        if result.converged:
            assert ((problem.H @ result.error) % 2 == syndrome).all()
        assert result.weight == pytest.approx(tier.weights[result.error.astype(bool)].sum())
        assert (result.features is not None) == tier.has_features


def test_syndrome_consistent_is_not_logically_correct():
    """An answer can explain the whole syndrome and still flip a logical operator.

    BP-OSD always returns a syndrome-consistent error. At p = 0.007 some of them are wrong.
    """
    noisy = Problem("X", 0.007)
    syndromes, _, obs, _ = noisy.sample(25, seed=1)
    tier = build("bposd", noisy)
    results = [tier.decode_shot(s) for s in syndromes]
    assert all(((noisy.H @ r.error) % 2 == s).all() for r, s in zip(results, syndromes))
    wrong = [((noisy.L @ r.error) % 2 != o).any() for r, o in zip(results, obs)]
    assert any(wrong) and not all(wrong)


def test_unknown_tier_is_refused(problem):
    with pytest.raises(ValueError):
        build("magic", problem)


# ---- features ---------------------------------------------------------------------------

def test_features_are_finite_and_named(tier1_results):
    F = np.array([r.features for r in tier1_results])
    assert F.shape[1] == len(features.NAMES) == len(set(features.NAMES)) and np.isfinite(F).all()
    assert sorted(sum(features.GROUPS.values(), [])) == sorted(features.NAMES)


def test_feature_values(problem, shots, tier1_results):
    for syndrome, other, result in zip(shots[0], shots[1], tier1_results):
        f = dict(zip(features.NAMES, result.features))
        grid = syndrome.reshape(13, 72)
        assert f["syndrome_weight"] == syndrome.sum() and f["other_basis_weight"] == other.sum()
        assert f["max_round_weight"] == grid.sum(axis=1).max() and f["distinct_checks"] == grid.any(axis=0).sum()
        assert f["solution_size"] == result.error.sum() and f["converged"] == result.converged
        assert f["log10_p"] == pytest.approx(np.log10(0.004)) and f["heralds"] == 0


def test_features_cannot_see_labels():
    """No label leakage: the extractor is not given observables or the true error."""
    names = set(inspect.signature(features.extract).parameters)
    assert names == {"syndrome", "result", "weights", "problem", "pre_iter", "other_weight", "fired", "herald_columns", "second"}
    source = inspect.getsource(features)
    assert "observable" not in source.replace("true observables", "") and ".L" not in source


def test_feature_groups_select_columns():
    assert features.columns_of(["loss"]) == [features.NAMES.index(n) for n in features.GROUPS["loss"]]


# ---- risk model -------------------------------------------------------------------------

@pytest.mark.parametrize("kind", ["logistic", "gbm"])
def test_model_learns_calibrates_and_reloads(kind, tmp_path):
    F, y = synthetic(6000, 0)
    Fc, yc = synthetic(3000, 1)
    Ft, yt = synthetic(3000, 2)
    model = calibrate(train(F, y, kind=kind), Fc, yc)
    q = quality(model, Ft, yt)
    assert q["auc"] > 0.93 and q["ece"] < 0.03 and abs(q["mean_risk"] - q["base_rate"]) < 0.02
    joblib.dump(model, tmp_path / "model.joblib")
    again = joblib.load(tmp_path / "model.joblib")
    assert again.risks(Ft[:50]) == pytest.approx(model.risks(Ft[:50]))
    assert model.risk(Ft[0]) == pytest.approx(model.risks(Ft[:1])[0])   # per-shot equals batch


def test_heuristic_model_orients_its_feature():
    F, y = synthetic(4000, 3)
    model = train(F, y, kind="heuristic", feature="solution_weight")
    G = F.copy()
    G[:, features.NAMES.index("solution_weight")] *= -1
    flipped = train(G, y, kind="heuristic", feature="solution_weight")
    assert quality(calibrate(model, F, y), F, y)["auc"] > 0.8
    assert flipped.coef[0] == -model.coef[0]


def test_unconverged_shots_have_risk_one():
    F, _ = synthetic(5, 4)
    F[2, CONVERGED] = 0
    model = constant_model(0.01)
    assert model.risks(F)[2] == 1.0 and model.risk(F[2]) == 1.0 and model.risk(F[0]) == pytest.approx(0.01)


# ---- routing ----------------------------------------------------------------------------

def test_better_prefers_converged_then_lighter():
    e = np.zeros(1, np.uint8)
    light, heavy, lost = TierResult(e, True, 1, 5.0), TierResult(e, True, 1, 9.0), TierResult(e, False, 1, 1.0)
    assert better(heavy, light) is light and better(light, heavy) is light
    assert better(lost, heavy) is heavy and better(heavy, lost) is heavy


def test_threshold_controls_the_path(problem, shots):
    never, always = AegisDecoder(problem, constant_model(0.01), 0.5, tier1="fast", tier2="strong"), AegisDecoder(problem, constant_model(0.9), 0.5, tier1="fast", tier2="strong")
    for syndrome in shots[0][:5]:
        fast, full = never.decode_shot(syndrome), always.decode_shot(syndrome)
        assert fast.escalated == (not fast.converged or fast.risk >= 0.5) and full.escalated
        assert full.converged and ((problem.H @ full.error) % 2 == syndrome).all()
        assert full.weight <= full.tier1_weight + 1e-9 or not fast.converged
        assert full.seconds_tier2 > 0 and fast.seconds_tier1 > 0


def test_cached_routing_equals_the_online_decoder(problem, shots):
    """policy.route on cached tier records gives the same answers as AegisDecoder."""
    model, threshold = constant_model(0.3), 0.2      # every shot escalates
    tiers = {name: build(name, problem) for name in ("fast", "strong")}
    records = {}
    for name, tier in tiers.items():
        results = [tier.decode_shot(s) for s in shots[0][:8]]
        failed = [((problem.L @ r.error) % 2 != o).any() for r, o in zip(results, shots[2])]
        records[name] = {"failed": np.array(failed), "converged": np.array([r.converged for r in results]),
                         "weight": np.array([r.weight for r in results]), "seconds": np.ones(8)}
    failed, seconds, escalated = policy.route(records["fast"], records["strong"], np.ones(8, bool), overhead=0.5)
    online = AegisDecoder(problem, model, threshold, tier1="fast", tier2="strong")
    online_failed = [((problem.L @ online.decode_shot(s).error) % 2 != o).any() for s, o in zip(shots[0][:8], shots[2])]
    assert list(failed) == online_failed and escalated.all() and (seconds == 2.5).all()


def test_route_without_escalation_keeps_tier_one():
    first = {"failed": np.array([True, False, True]), "converged": np.array([True, True, False]),
             "weight": np.array([5.0, 5.0, 5.0]), "seconds": np.array([1.0, 1.0, 1.0])}
    second = {"failed": np.array([False, True, False]), "converged": np.array([True, True, True]),
              "weight": np.array([4.0, 4.0, 9.0]), "seconds": np.array([10.0, 10.0, 10.0])}
    failed, seconds, escalated = policy.route(first, second, np.zeros(3, bool))
    assert list(failed) == [True, False, False] and list(escalated) == [False, False, True]   # unconverged escalates
    assert list(seconds) == [1.0, 1.0, 11.0]


# ---- statistics -------------------------------------------------------------------------

def test_logical_error_rate_per_cycle():
    assert policy.per_cycle(0.0) == 0 and policy.per_cycle(1 - 0.5 ** 12) == pytest.approx(0.5)
    fx, fz = np.array([True, True, False, False]), np.zeros(4, bool)
    s = policy.summarize(fx, fz, np.full(4, 0.010), np.full(4, 0.030))
    assert s["failures_pair"] == 2 and s["ler"] == pytest.approx(1 - 0.5 ** (1 / 12))   # a pair fails if either fails
    assert s["ms_mean"] == pytest.approx(40.0) and s["ms_p99"] == pytest.approx(40.0)    # pair time = X + Z
    assert s["ler_ci95"][0] < s["ler"] < s["ler_ci95"][1]


def test_pairs_use_the_kits_independent_z_partner():
    """X shot k is paired with Z shot z_partner(n)[k], never with Z shot k: same-seed X and Z records
    share Stim's random stream, so equal indices are correlated samples (the review fix on main)."""
    import analyze
    n = 50
    partner = policy.partner(n)
    assert (partner == analyze.z_partner(n)).all() and (partner != np.arange(n)).all()
    assert sorted(partner) == list(range(n))                       # a permutation: every Z shot used once
    for j in (0, 7, 49):
        fz = np.zeros(n, bool)
        fz[j] = True
        pair = policy.pair_failures(np.zeros(n, bool), fz)
        assert list(np.flatnonzero(pair)) == [int(np.flatnonzero(partner == j)[0])]
    sz = np.arange(n, dtype=float)
    assert (policy.pair_seconds(np.zeros(n), sz) == sz[partner]).all()
    with pytest.raises(ValueError):
        policy.pair_failures(np.zeros(4, bool), np.zeros(5, bool))   # no broadcasting of mismatched records


def test_clopper_pearson_interval():
    import analyze
    low, high = policy.clopper_pearson(0, 1000)
    assert low == 0 and high == pytest.approx(1 - 0.025 ** (1 / 1000))   # exact zero-failure bound
    low, high = policy.clopper_pearson(50, 1000)
    assert 0.037 < low < 0.05 < high < 0.066
    failed = np.zeros(1000, bool)
    failed[:50] = True
    _, lo_cycle, hi_cycle, _ = analyze.per_cycle_ci(failed)
    assert (policy.per_cycle(low), policy.per_cycle(high)) == pytest.approx((lo_cycle, hi_cycle))


def test_paired_comparison():
    rng = np.random.default_rng(0)
    b = rng.random(20000) < 0.05
    a = b & (rng.random(20000) < 0.5)            # A fails on half of B's failures and nowhere else
    result = policy.compare(a, b, np.full(20000, 10.0), np.full(20000, 40.0))
    assert result["only_a_fails"] == 0 and result["mcnemar_p"] < 1e-6
    assert result["ler_ratio_ci95"][0] < 0.5 < result["ler_ratio_ci95"][1] and result["speedup_mean"] == pytest.approx(4.0)


def test_threshold_selection():
    points = [{"threshold": t, "failures_pair": f, "ler": f / 1000, "ms_mean": ms}
              for t, f, ms in [(0.0, 10, 100.0), (0.01, 10, 40.0), (0.1, 12, 20.0), (1.0, 30, 10.0)]]
    assert policy.select_threshold(points, target_failures=10)["threshold"] == 0.01
    assert [q["threshold"] for q in policy.pareto(points)] == [1.0, 0.1, 0.01]
    risk = np.linspace(0, 1, 1001)
    assert (risk >= policy.threshold_for_budget(risk, 0.1)).mean() == pytest.approx(0.1, abs=0.002)


# ---- data splits and caching ------------------------------------------------------------

def test_splits_use_distinct_seeds():
    assert len({TRAIN_SEED, TEST_SEED, VAL_SEED, collect.SEEDS["calib"]}) == 4
    assert (TRAIN_SEED, TEST_SEED) == (1, 2)   # TEAM_PLAN.md
    a, b = Problem("Z", 0.004).sample(10, TRAIN_SEED), Problem("Z", 0.004).sample(10, TEST_SEED)
    assert (a[0] != b[0]).any()


def test_training_never_reads_test_records():
    from aegis import train as train_module
    source = inspect.getsource(train_module)
    assert '"test"' not in source and "test_" not in source


def test_collect_caches_resumes_and_is_reproducible(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "RECORDS", tmp_path / "records")
    monkeypatch.setattr(collect, "DATA", tmp_path / "data")
    monkeypatch.setattr(collect, "MANIFEST", tmp_path / "manifest.json")
    quiet = lambda *_: None
    path = collect.collect("val", "X", 0.003, 0.0, 16, ["fast"], workers=2, chunk=8, log=quiet)
    first = collect.load(path)
    assert first["fast"]["features"].shape == (16, len(features.NAMES)) and first["seed"] == VAL_SEED
    # A second tier is added to the same file. The first is not decoded again.
    collect.collect("val", "X", 0.003, 0.0, 16, ["fast", "bp30"], workers=1, chunk=16, log=quiet)
    second = collect.load(path)
    assert (second["fast"]["seconds"] == first["fast"]["seconds"]).all() and "bp30" in second
    assert "features" not in second["bp30"]
    # Same seed and chunk size, other worker count: identical decoding results.
    collect.collect("val", "X", 0.003, 0.0, 16, ["fast"], workers=1, chunk=8, force=True, log=quiet)
    third = collect.load(path)
    assert (third["fast"]["predicted"] == first["fast"]["predicted"]).all()
    assert third["fast"]["features"] == pytest.approx(first["fast"]["features"])
    with pytest.raises(ValueError):
        collect.collect("test", "X", 0.003, 0.0, 16, ["fast"], seed=5, log=quiet)
    with pytest.raises(ValueError):
        collect.collect("val", "X", 0.003, 0.0, 32, ["bp200"], log=quiet)   # other shot count, same file


# ---- second opinion -----------------------------------------------------------------------

def test_second_opinion_runs_only_on_hard_converged_shots(problem):
    """BP+OSD-0 is consulted when tier 1 converged after its first leg, and never otherwise."""
    noisy = Problem("X", 0.005)
    syndromes, _, _, _ = noisy.sample(40, seed=12)
    tier = build("fast", noisy)
    ran = 0
    for syndrome in syndromes:
        result = tier.decode_shot(syndrome)
        f = dict(zip(features.NAMES, result.features))
        hard = result.converged and result.iterations > tier.pre_iter
        assert f["second_run"] == hard
        if not hard:
            assert f["second_disagrees"] == 0 and f["second_weight_gap"] == 0
        ran += hard
    assert 0 < ran < 40
    assert build("relay", noisy).second is None and build("strong10", noisy).second is None


def test_second_opinion_compares_predictions_not_truth(problem, shots):
    """Disagreement is the difference of the two decoders' own logical predictions."""
    tier = build("fast", problem)
    result = tier._decode(shots[0][0])
    result.weight = float(tier.weights[result.error.astype(bool)].sum())
    result.iterations = tier.pre_iter + 1                 # pretend the shot was hard
    disagrees, gap = tier._second_opinion(shots[0][0], result)
    other = np.asarray(tier.second.decode(shots[0][0]), np.uint8)
    assert disagrees == bool(((problem.L @ other) % 2 != (problem.L @ result.error) % 2).any())
    assert gap == pytest.approx(tier.weights[other.astype(bool)].sum() - result.weight)
    assert "obs" not in inspect.signature(tier._second_opinion).parameters


def test_relay_bp_depends_on_history_and_reset_removes_it():
    """Why collect resets decoders per chunk: relay-BP's random stream runs on between shots."""
    noisy = Problem("X", 0.006)
    syndromes, _, _, _ = noisy.sample(12, seed=2)
    tier = build("relay", noisy)
    first = [tier.decode_shot(s).iterations for s in syndromes]
    second = [tier.decode_shot(s).iterations for s in syndromes]      # same decoder, later in its stream
    tier.reset()
    third = [tier.decode_shot(s).iterations for s in syndromes]
    assert first != second and first == third


def test_compiled_risk_equals_scikit_learn_exactly():
    """RiskModel.risk walks the trees itself (CompiledTrees); it must return the same float as the
    scikit-learn decision function plus Platt scaling, on real tier-1 feature vectors."""
    import joblib
    from aegis.collect import RECORDS, load
    from aegis.paths import MODELS
    model = joblib.load(MODELS / "aegis_router.joblib")
    F = load(RECORDS / "val_X_p0.005.npz")[model.meta["tier1"]]["features"]
    slow = model.risks(F)
    assert all(model.risk(F[k]) == slow[k] for k in range(len(F)))
    nan = F[0].copy()
    nan[model.columns[0]] = np.nan                      # missing values follow scikit-learn's learned direction
    assert model.risk(nan) == float(model.risks(nan[None, :])[0])


def test_demo_runs_on_fresh_shots(monkeypatch, capsys):
    """python -m aegis.demo decodes a few seed-99 shots with the frozen v2 model and relay-BP."""
    import sys
    from aegis import demo
    monkeypatch.setattr(sys, "argv", ["demo", "--p", "0.003", "--shots", "3"])
    demo.main()
    out = capsys.readouterr().out
    assert "QEC-Aegis v2 (speed)" in out and "3 shots: QEC-Aegis" in out
