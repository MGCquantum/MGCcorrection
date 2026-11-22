# data/

Generated datasets. Nothing here is committed except this file.

- Make them with the kit: `python challenge-1-ml-decoder-kit/make_dataset.py --basis X --p 0.004 --shots 20000 --seed 1 --out data/train_X_p0.004.npz`
- Names: `<split>_<basis>_p<p>.npz`, built by `mgccorrection.paths.dataset_name`.
- Seeds (TEAM_PLAN.md): **1 = train, 2 = test.** Never mix them.
- Per-shot decoder records from `run_job.py` go to `challenge-1-ml-decoder-kit/results/`, where `analyze.py` reads them.
