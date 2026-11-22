"""Shared project infrastructure for MGCcorrection: paths and logging.

The official starter kit in challenge-1-ml-decoder-kit/ is kept as shipped. Importing this
package puts the kit on the import path, so `import circuit` and `import decoders` work from
anywhere in the repository.
"""
import sys

from .paths import KIT

if str(KIT) not in sys.path:
    sys.path.insert(0, str(KIT))

REQUIRED_SWEEP = (0.003, 0.004, 0.005)   # physical error rates the challenge requires
CYCLES = 12                              # noisy syndrome cycles of the kit's Gross code circuits
