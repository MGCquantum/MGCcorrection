"""Where things live. See docs/SETUP.md for the conventions."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIT = ROOT / "challenge-1-ml-decoder-kit"   # official starter kit plus the team's job scripts
RESULTS = KIT / "results"                   # per-shot decoder records (*.npz), read by analyze.py
DATA = ROOT / "data"                        # generated datasets, not committed
LOGS = ROOT / "logs"                        # run logs, not committed


def dataset_name(split, basis, p, f=0.0):
    """File name of a dataset or result, e.g. test_X_p0.004.npz or erase_Z_p0.004_f0.5.npz.

    Matches TEAM_PLAN.md: split is 'train' (seed 1) or 'test' (seed 2), and files with an
    erasure fraction f > 0 are named erase_*.
    """
    return f"erase_{basis}_p{p}_f{f}.npz" if f else f"{split}_{basis}_p{p}.npz"
