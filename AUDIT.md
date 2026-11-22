# Challenge 1 readiness audit

**Status: required submission evidence is complete and locally verified.**
This is our evidence audit, not an official judging certification or a claim that
the decoder is optimal. All computation in this audit ran on the local Mac.

Official source: [Infleqtion/MidQWest-2026](https://github.com/Infleqtion/MidQWest-2026),
revision `31ceda8be4949a308d95ec9bc7c32029c80d90d2`, reviewed 2026-11-21.
`CHALLENGE.md` matches that revision. The sponsor's baseline Python files and
Gross-code circuits remain unchanged; our extensions sit alongside them.

## Required evidence

| Official requirement | Verified evidence | Status |
|---|---|---|
| Set up Gross-code memory experiments and reproduce BP-OSD and relay-BP | Unchanged sponsor circuits/settings; both baselines in all three sweep points; kit references lie inside the cached 95% intervals | PASS |
| Simulate noise and use heralding where available | `lossy.py`, corrected conditional priors, paired flag-hidden/flag-used runs at f=0, 0.25, 0.5, 0.75 | PASS |
| Working ML-assisted decoder using syndrome information | Shared `hybrid.py` training/features/live inference; asserted tests run the real fast-BP, relay-BP and fallback paths; `demo.py` shows a fresh shot | PASS |
| Same-data baseline comparison at p=0.003, 0.004, 0.005 | Full accuracy sweep, both X/Z bases, BP-OSD, relay-BP, rule and ML hybrids; no test labels enter router training | PASS |
| Report logical error rate | Exact Clopper-Pearson intervals and failed-pair counts in `results/results.csv` | PASS |
| Report decoding latency | Mean/p99 in accuracy caches plus a complete same-shot local comparison (300 shots per basis, 150 independent pairs) with both baselines in `results_local_timing` | PASS, concurrent-load caveat |
| Report resource requirements | Local Apple M5 demos: 718 kB router; 191–196 MB peak process RSS including imports/training; 936 x 8784 matrix; roughly 0.02–0.03 s setup | PASS |
| GitHub code for decoder, data generation and evaluation | `run_job.py`, `make_dataset.py`, `hybrid.py`, `analyze.py`; complete commands in `RUN.md`; dependencies and local lockfile | PASS |
| Comparison plot | `figures/erasure.png`, `figures/relay_flags.png`, `figures/speed_local.png`, and `results/results.png` (all experiments, including relay flags); zero-failure bounds use separate triangles | PASS |
| Short presentation or demo | Updated root `PITCH.md`; successful fresh X and Z live demos, seed 99 | PASS |
| Explain strengths, weaknesses, and ML's role | README/PITCH explicitly separate the erasure gain from the router's negative result | PASS |

## Repeatable checks and evidence files

From `challenge-1-ml-decoder-kit` after installing `requirements-dev.txt`:

```bash
bash scripts/verify_submission.sh
```

- **45/45 tests pass:** 23 sponsor-kit tests plus 22 extension regressions, including
  herald-conditioned priors, cache integrity, training/test separation, independent
  pairing, seed derivation, incomplete-experiment rejection, plot coverage, and the real
  live fast-BP, relay-BP and fallback decoding paths.
- **73/73 data/evaluation checks pass:** `run_records/challenge1_audit.json` includes
  every check, hashes of 30 input files, exact paired-test statistics and caveats. The
  relay-flags experiment is checked against an explicit expected seed manifest
  (`EXPECTED_RELAY_SEEDS`); a missing X or Z file fails the audit.
- `run_records/verification.log` records the successful full verification run.
- `run_records/demo_local_X.log` and `demo_local_Z.log` show fresh-shot demos
  (illustrative; the asserted live checks are the tests).
- `run_records/corrected_erasure.log` and `local_timing.log` record completed jobs;
  `local_timing_analysis.log` is the final timing analysis.
- `requirements-local-lock.txt` records the actual Python 3.13 environment.

Paths above are relative to the kit directory. Accuracy counts reproduce from the
caches; newly measured router timings and memory usage naturally vary.

## Scientific correction found and fixed

The original `lossy.aware_matrices` counted detector-error-model instructions as
Pauli components. Stim can already merge two Pauli outcomes into one instruction,
so this sometimes assigned a conditional probability of 1/4 instead of 1/2.
We now recover multiplicity from the probability mass divided by the herald-event
probability and sum mutually exclusive outcomes sharing that herald.

A one-qubit simulation regression verifies the expected conditional flip rate.
On the Gross code at p=0.004, f=0.5, the correction changes multiplicities in
1,440 X-basis and 1,584 Z-basis columns out of 31,968 per basis.
All six nonzero-erasure X/Z runs were regenerated with both decoders together;
training seeds, test seeds and shot counts were preserved. The no-erasure sweep
is unaffected. Prior results remain available in Git history, not as current claims.

Corrected paired results (BP-OSD; independent disjoint-half pairs, see below):

| Erasure fraction | Pairs | Flags hidden failures | Flags used failures | Exact paired p-value |
|---|---:|---:|---:|---:|
| 0% | 500 | 27 | 27 | 1 |
| 25% | 500 | 8 | 4 | 0.289 |
| 50% | 1,000 | 8 | 2 | 0.031 |
| 75% | 1,000 | 4 | 0 | 0.125 |

Only the 50% result is significant, with about 6.7x more decode time. Zero failures at
75% is an upper-bound result, not zero underlying error probability. See README for intervals.

## Independent review fixes (2026-11-21)

An outside review of revision ac4c133 found, and this revision fixes:

- **Correlated X/Z pairs.** X and Z runs with one seed get the same Stim random stream
  (syndrome-weight correlation about 0.5; at p=0.005, 15 shared relay failures where about
  3 are expected). This revision paired each X shot with a random derangement of the Z
  shots; that was superseded by disjoint-half pairing (see the second review fixes).
- **relay_flags prior folding** now combines identical effects by parity, (1 - prod(1-2q))/2,
  keeping exact 0.5. All relay-flags results were regenerated after this fix.
- **Analysis guards:** X/Z shapes must match (no broadcasting); stored basis/p/f/seed must match
  file names; `bp_flags` and `relay_flags` are analyzed; `erase4_*` relay-flags files are
  analyzed and audited.
- Not changed: `demo.py` prints WRONG without failing, because a correct decoder can fail on
  a noisy shot; pass/fail decoding checks live in the tests (now including real live paths).

## Second review fixes (2026-11-22)

Reviews of 7f3d3a0 and 6d298eb found, and this revision fixes:

- **Shuffled pairs were not independent.** The derangement moved correlated X_k/Z_k into
  neighbouring pairs; a simulation with X_k = Z_k gave about twice the binomial variance.
  `analyze.independent_pairs` now draws X and Z shots from disjoint halves of the indices,
  so no shot index appears in two pairs and the exact intervals and McNemar tests are valid
  (a regression test checks binomial variance under full X/Z correlation). Pair counts halve.
  All tables, figures and logs were regenerated.
- **Independent streams for new data.** `run_job.py` derives the Stim seed with numpy
  `SeedSequence` from (scheme, root seed, split, basis, p, f), records `split`,
  `seed_scheme`, `sampler_seed` and `circuit_sha256`, and keeps `seed` as the root run
  identity. Such caches are paired row by row (`analyze.pairing_for`); mixing them with
  legacy caches is rejected. The existing evidence was not regenerated with this scheme.
- **Incomplete relay experiments now fail the audit.** Files of both bases are enumerated
  first, orphans are reported, and the audit checks an expected seed manifest. Analysis of a
  partial set is labelled `erasure_relay_partial`.
- **Live decoder checks.** Tests run the real `HybridDecoder` on the Gross-code matrix with
  deterministic inputs (zero syndrome and a single fault) through fast BP and relay-BP,
  plus a forced fallback, and assert the answers. The noisy demo stays illustrative.
- **Plots and docs.** `analyze.py`'s plot includes the relay-flags experiment; both plotting
  scripts share one CI helper. "Slowest 1%" is relabelled p99 latency; hybrid-only
  limitations are labelled as such; planning notes moved to `docs/history/`.

## Relay-BP with loss flags

| p | Pairs | Flags ignored failures | Flags used failures | Only ignored / only used | Exact paired p-value | Mean ms ignored -> used |
|---|---:|---:|---:|---:|---:|---:|
| 0.004 | 10,000 | 19 | 1 | 19 / 1 | 4.0e-5 | 177 -> 83 |
| 0.005 | 5,000 | 70 | 3 | 68 / 1 | 2.4e-19 | 571 -> 122 |

## Remaining limitations and optional work

- The ML router does not beat the simple convergence rule. The erasure gain comes
  from physically informed priors, not from learned loss correction. No broad claim
  that learning cannot improve decoding is supported.
- Erasures are instantaneous, located and reset to the code space, not persistent
  atom loss or delayed detection. Preparation and measurement errors remain.
- [Stim's heralded-erasure reference](https://github.com/quantumlib/Stim/blob/main/doc/gates.md#heralded_erase)
  explains the independent-error DEM approximation. We sample circuits, not DEMs;
  corrected marginal priors still do not make BP-OSD an exact joint decoder.
- Legacy caches lack full sample hashes. Extra-cache compatibility uses seed,
  conditions, round weights and flag counts. This is not a mathematical proof of
  shot identity. New runs include full detector/observable SHA-256 fingerprints.
- Local timing overlapped other computation and is labeled accordingly. Historical
  idle-laptop timing is retained separately and lacks BP-OSD. Hybrid times compose
  cached branch costs plus measured inference; they are not a service benchmark.
- Samples are finite, particularly at p=0.003 and in the 150-pair timing sweeps. Legacy
  caches use disjoint-half pairing, which discards half the shots per comparison; rerunning
  with the `ss-v1` seed scheme would recover full sample sizes.
  Same observed hybrid/relay failure counts do not prove equal underlying rates.
- Optional stretch goals: the learned router is implemented and CPU resources are
  measured. Second-code evaluation, sliding windows, distance scaling and GPU cost
  estimates are not claimed. They are not required by the sponsor's deliverables.
