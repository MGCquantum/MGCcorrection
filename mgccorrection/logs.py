"""One logging setup for every script: console plus a timestamped file under logs/."""
import logging
import time

from .paths import LOGS


def get_logger(name, to_file=True):
    """Logger that prints to the console and, by default, appends to logs/<name>_<time>.log."""
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", "%Y-%m-%d %H:%M:%S")
    handlers = [logging.StreamHandler()]
    if to_file:
        LOGS.mkdir(exist_ok=True)
        handlers.append(logging.FileHandler(LOGS / f"{name}_{time.strftime('%Y%m%d_%H%M%S')}.log"))
    for handler in handlers:
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    return logger
