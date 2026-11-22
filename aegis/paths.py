"""Where things live. Importing this module puts the starter kit on the import path, so the kit's
own modules (circuit, decoders, lossy, analyze) are used unchanged and are the single source of
truth for circuits, baseline settings, heralded-erasure priors, X/Z pairing and statistics."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIT = ROOT / "challenge-1-ml-decoder-kit"   # sponsor starter kit plus the team's audited extensions
DATA = ROOT / "data"                        # per-shot records
RECORDS = DATA                              # committed: validation, test and timing records
TRAIN_RECORDS = DATA / "train"              # not committed: training and calibration records (regenerable)
MANIFEST = DATA / "manifest.json"           # how every record was produced
REPORTS = ROOT / "results"                  # evaluations, selections, frozen hashes, CSV
FIGURES = REPORTS / "figures"               # every plot
MODELS = ROOT / "models"                    # committed risk models chosen on validation shots

if str(KIT) not in sys.path:
    sys.path.insert(0, str(KIT))
