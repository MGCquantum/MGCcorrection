# BP-OSD p=0.005 local run

Status: environment setup in progress; no new decoder results yet.

- Starting revision: c7c89d5.
- Execution: local macOS computer, 10 CPU cores, 16 GiB RAM. No cloud jobs.
- Requested configuration: X and Z, p=0.005, 2000 shots per basis, seed 2.
- Preserve all Python source files and existing result filenames.
- Before decoding, compare regenerated round weights with saved test files.
- If shots differ, run bp, relay, and bposd together for that basis.
- Validate analysis and all five requested checks before publishing results to main.
- Progress is saved on this branch. This record is not evidence of a completed run.

## Environment and compatibility

Dependencies installed successfully in the kit's local `.venv` using Python 3.13.
Versions: stim 1.16.0, ldpc 2.4.1, numpy 2.5.5, scipy 1.18.1,
relay-bp 0.2.2, scikit-learn 1.9.1.

- X: SAME as saved round weights.
- Z: SAME as saved round weights.
- Both bases: full detector and observable samples from the compatibility check
  also equal the flattened circuit sampling path actually used by run_job.py.
- No existing run_job.py process was present before launch.
- Run both bases concurrently with 4 workers each to share the 10 local CPU cores.
- Laptop reported 22% battery before launch; user was asked to connect power.

Status: ready to run BP-OSD only, 2000 shots per basis, seed 2.

## Launch

Both BP-OSD jobs launched locally under caffeinate with `--workers 4`.
A separate pre-existing `aegis.collect` experiment in another checkout was observed
using eight workers after launch. It was not interrupted. Runtime measurements
from this concurrent run must not be treated as idle-machine speed benchmarks.

## Completion

Both local BP-OSD runs completed. Analysis and all five requested sanity checks
passed; the raw extras also match the original metadata, round weights, and flags.
See the adjacent basis, analysis, and validation logs for exact counts and timings.
Figures were regenerated. No Python source files were changed.
Results are checkpointed on the progress branch pending final main publication.
