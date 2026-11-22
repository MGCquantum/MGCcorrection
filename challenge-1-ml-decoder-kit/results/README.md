# Legacy evidence (first submission)

These caches were generated before the `ss-v1` seed scheme. X and Z runs with the same
root seed reused one Stim random stream, so X shot k and Z shot k are correlated.
`analyze.py` therefore pairs them with disjoint-half pairing (`analyze.independent_pairs`),
which keeps the exact intervals and McNemar tests valid but uses half the shots.

They are kept unchanged as history and are still audited by `scripts/verify_submission.sh`
(`run_records/legacy_audit.json`). The `results_local_timing` sweep trains its router on
the training files here. The current evidence is `results_v2/`: the same commands, rerun
with independent X/Z and train/test streams, paired row by row. Of 24 matching rows, 23 show
no significant difference (Fisher exact p > 0.05); the exception is BP-OSD at p = 0.003
(7/2,500 here vs 33/5,000 in `results_v2`, p = 0.04), about what 24 tests give by chance.
The new seeds were fixed in advance (same root seeds and commands), not chosen by outcome.
