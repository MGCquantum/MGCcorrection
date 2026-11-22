"""Validate Challenge 1 evidence without rerunning expensive baseline decoding.

python audit_submission.py --out run_records/challenge1_audit.json
Legacy caches predate full sample hashes; report that limitation instead of treating
per-round weights as a cryptographic proof of shot identity.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from threadpoolctl import threadpool_limits
from scipy.stats import binomtest

from analyze import load, missing_relay_partners, pair_arrays, paired, pairing_for, policies, relay_flag_files, relay_flag_groups, train_router

REFERENCE = {0.003: {'relay': 4.2e-5, 'bposd': 4.7e-4},
             0.004: {'relay': 8.7e-4, 'bposd': 4.4e-3},
             0.005: {'relay': 6.9e-3, 'bposd': 2.3e-2}}

# The submitted relay-flags experiment: every (p, f) group and the seeds it must contain, each with
# both an X and a Z file. Update this together with any accepted new data.
EXPECTED_RELAY_SEEDS = {(0.004, 0.5): [32, 33], (0.005, 0.5): [31]}


def validate_cache(d, path):
    n = int(d['shots'])
    if n < 1 or d['round_weights'].shape != (n, 13) or d['n_flags'].shape != (n,):
        raise ValueError(f'{path}: inconsistent shot/feature dimensions')
    for key in ['round_weights', 'n_flags']:
        value = d[key]
        if not np.isfinite(value).all() or (value < 0).any() or not np.equal(value, np.floor(value)).all():
            raise ValueError(f'{path}: invalid count features in {key}')
    if (d['round_weights'] > 72).any():
        raise ValueError(f'{path}: more alarms than checks in a round')
    for key, value in d.items():
        if key.startswith(('fail_', 'conv_', 'time_')):
            if value.shape != (n,):
                raise ValueError(f'{path}: {key} length does not match shots')
            if key.startswith('time_'):
                if not np.isfinite(value).all() or (value < 0).any():
                    raise ValueError(f'{path}: invalid decoder timings')
            elif not np.isin(value, [False, True]).all():
                raise ValueError(f'{path}: {key} is not binary')


def audit(dirname):
    dirname = Path(dirname)
    report = {'official_revision': '31ceda8be4949a308d95ec9bc7c32029c80d90d2',
              'checks': [], 'warnings': [], 'sweep': [], 'erasure': [],
              'input_sha256': {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in sorted(dirname.glob('*.npz'))}}
    def check(label, passed):
        report['checks'].append({'check': label, 'pass': bool(passed)})
    for p in REFERENCE:
        router = train_router(str(dirname), p)
        check(f'p={p}: seed-1 trained router exists', router is not None)
        if router is None:
            continue
        decoded, records = [], []
        for basis in 'XZ':
            path = dirname / f'test_{basis}_p{p}.npz'
            d = load(str(path))
            validate_cache(d, path)
            check(f'p={p} {basis}: held-out seed-2 f=0 conditions',
                  int(d['seed']) == 2 and str(d['basis']) == basis and
                  float(d['p']) == p and float(d['f']) == 0)
            for dec in ['bp', 'bposd', 'relay']:
                check(f'p={p} {basis}: {dec} cached', all(k+'_'+dec in d for k in ['fail','time','conv']))
            if 'sample_sha256' not in d:
                report['warnings'].append(f'{path}: legacy cache; same-shot merges checked by metadata, round weights and flags, not a full sample hash')
            decoded.append(policies(d, router)); records.append(d)
        px, pz = decoded
        how = pairing_for(*records)
        for dec in ['bp','bposd','relay','hybrid_rule','hybrid_ml']:
            if dec not in px or dec not in pz:
                check(f'p={p}: {dec} paired result', False)
                continue
            rate, lo, hi, k, n, mean, p99 = paired(px, pz, dec, how)
            report['sweep'].append(dict(p=p, decoder=dec, failed_pairs=k, pairs=n,
                rate_per_cycle=rate, ci_low=lo, ci_high=hi, mean_ms=mean, p99_ms=p99))
            check(f'p={p}: {dec} finite latency and valid CI',
                  np.isfinite([mean,p99,rate,lo,hi]).all() and 0 <= lo <= rate <= hi <= 1)
            if dec in REFERENCE[p]:
                check(f'p={p}: {dec} kit reference within 95% interval', lo <= REFERENCE[p][dec] <= hi)
        relay_failed = pair_arrays(px, pz, 'relay', how)[0]
        for name in ['hybrid_rule','hybrid_ml']:
            # Equal counts are not guaranteed: the hybrid keeps BP's converged answer where relay-BP
            # may differ. Require that it is not significantly worse (one-sided exact paired test).
            hyb_failed = pair_arrays(px, pz, name, how)[0]
            only_hyb = int((hyb_failed & ~relay_failed).sum())
            discordant = only_hyb + int((relay_failed & ~hyb_failed).sum())
            p_worse = binomtest(only_hyb, discordant, .5, alternative='greater').pvalue if discordant else 1.
            check(f'p={p}: {name} not significantly worse than relay (one-sided p={p_worse:.2g})',
                  p_worse >= .05)
    for f in [0., .25, .5, .75]:
        arrays = []
        for basis in 'XZ':
            path = dirname / f'erase_{basis}_p0.004_f{f:g}.npz'
            d = load(str(path)); validate_cache(d, path)
            check(f'f={f} {basis}: erasure metadata', float(d['f']) == f and float(d['p']) == .004
                  and str(d['basis']) == basis and int(d['seed']) == 2)
            arrays.append(d)
        pol = [policies(d, None) for d in arrays]
        how = pairing_for(*arrays)
        blind, blind_ms = pair_arrays(*pol, 'bposd', how)
        aware, aware_ms = pair_arrays(*pol, 'bposd_flags', how)
        only_blind = int((blind & ~aware).sum())
        only_aware = int((aware & ~blind).sum())
        discordant = only_blind + only_aware
        report['erasure'].append(dict(f=f, pairs=len(blind), failed_blind=int(blind.sum()),
            failed_aware=int(aware.sum()), only_blind=only_blind, only_aware=only_aware,
            mcnemar_p=binomtest(only_blind, discordant, .5).pvalue if discordant else 1.,
            blind_mean_ms=float(blind_ms.mean()), aware_mean_ms=float(aware_ms.mean())))
        check(f'f={f}: flags help or tie on saved pairs', aware.sum() <= blind.sum())
        if f == 0:
            check('f=0: flag-hidden and flag-used answers have identical failures', np.array_equal(blind, aware))
    report['relay_flags'] = []
    missing = missing_relay_partners(str(dirname))
    for p, f, s, b in missing:
        report['warnings'].append(f'erase4 p={p} f={f} seed={s}: {b} file missing')
    check('relay flags: every erase4 seed has both X and Z files', not missing)
    found = {}
    for (p, f, s) in relay_flag_files(str(dirname)):
        found.setdefault((float(p), float(f)), set()).add(s)
    check('relay flags: (p, f) groups match the expected manifest', set(found) == set(EXPECTED_RELAY_SEEDS))
    for key, seeds in sorted(EXPECTED_RELAY_SEEDS.items()):
        check(f'relay flags p={key[0]} f={key[1]}: seeds {seeds} all present', found.get(key, set()) == set(seeds))
    for (p, f), records in sorted(relay_flag_groups(str(dirname)).items()):
        for dx, dz in records:
            for d in (dx, dz):
                validate_cache(d, f"erase4 p={p} f={f} seed={int(d['seed'])} {d['basis']}")
        parts = {n: [pair_arrays(policies(dx, None), policies(dz, None), n, pairing_for(dx, dz)) for dx, dz in records] for n in ('relay', 'relay_flags')}
        blind = np.concatenate([q[0] for q in parts['relay']]); aware = np.concatenate([q[0] for q in parts['relay_flags']])
        only_blind, only_aware = int((blind & ~aware).sum()), int((aware & ~blind).sum())
        report['relay_flags'].append(dict(p=float(p), f=float(f), seeds=[int(dx['seed']) for dx, _ in records],
            pairs=len(blind), failed_blind=int(blind.sum()), failed_aware=int(aware.sum()),
            only_blind=only_blind, only_aware=only_aware,
            mcnemar_p=binomtest(only_blind, only_blind + only_aware, .5).pvalue if only_blind + only_aware else 1.,
            blind_mean_ms=float(np.concatenate([q[1] for q in parts['relay']]).mean()),
            aware_mean_ms=float(np.concatenate([q[1] for q in parts['relay_flags']]).mean())))
        check(f'relay flags p={p} f={f}: complete X/Z records for every expected seed',
              sorted(int(dx['seed']) for dx, _ in records) == sorted(EXPECTED_RELAY_SEEDS.get((float(p), float(f)), [])))
    report['passed'] = all(item['pass'] for item in report['checks'])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir', default='results_v2')
    parser.add_argument('--out', default='run_records/challenge1_audit.json')
    args = parser.parse_args()
    with threadpool_limits(limits=1):
        report = audit(args.dir)
    path = Path(args.out); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + '\n')
    for item in report['checks']:
        print(('PASS' if item['pass'] else 'FAIL') + ': ' + item['check'])
    for warning in report['warnings']: print('LIMITATION: ' + warning)
    print(f"{sum(c['pass'] for c in report['checks'])}/{len(report['checks'])} checks passed; {path}")
    raise SystemExit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()
