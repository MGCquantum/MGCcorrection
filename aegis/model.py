"""The risk model: P(tier-1 answer is logically wrong | features).

Three kinds share one interface:
  heuristic  one feature used as the score (no learning beyond calibration)
  logistic   standardized logistic regression, the lightweight learned baseline
  gbm        gradient-boosted trees (scikit-learn HistGradientBoostingClassifier)

Scores are calibrated with Platt scaling on shots the model was not trained on, so `risk` is a
probability and one threshold means the same thing at every noise strength.
A shot on which tier 1 did not converge has risk 1 by definition and never reaches the model.
"""
import os
from dataclasses import dataclass, field

# One decode is one thread. Without this, scikit-learn starts an OpenMP thread pool for every
# per-shot prediction, which costs far more than the prediction itself. threadpool_limits only
# reaches the thread that calls it, so the environment variable covers threads started later,
# such as the dashboard's request threads. It must be set before OpenMP starts.
os.environ.setdefault("OMP_NUM_THREADS", "1")

import numpy as np  # noqa: E402
from sklearn.ensemble import HistGradientBoostingClassifier  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import average_precision_score, roc_auc_score  # noqa: E402
from threadpoolctl import threadpool_limits  # noqa: E402

from . import features  # noqa: E402

threadpool_limits(1)

CONVERGED = features.NAMES.index("converged")


@dataclass
class RiskModel:
    kind: str
    columns: list                       # indices of the features the model reads
    estimator: object = None            # gbm: the fitted classifier
    coef: np.ndarray | None = None      # logistic and heuristic: score = (x - mean) / scale @ coef + intercept
    mean: np.ndarray | None = None
    scale: np.ndarray | None = None
    intercept: float = 0.0
    platt: tuple = (1.0, 0.0)           # risk = sigmoid(a * score + b)
    meta: dict = field(default_factory=dict)

    def scores(self, F):
        """Uncalibrated scores of a batch (rows of full feature vectors)."""
        x = np.asarray(F, np.float64)[:, self.columns]
        if self.kind == "gbm":
            return self.estimator.decision_function(x)
        return ((x - self.mean) / self.scale) @ self.coef + self.intercept

    def risks(self, F):
        """Calibrated risks of a batch. Unconverged tier-1 runs get 1."""
        F = np.atleast_2d(F)
        a, b = self.platt
        risk = 1 / (1 + np.exp(-(a * self.scores(F) + b)))
        return np.where(F[:, CONVERGED] > 0, risk, 1.0)

    def risk(self, f):
        """Calibrated risk of one shot."""
        if not f[CONVERGED]:
            return 1.0
        return float(self.risks(f[None, :])[0])


def train(F, y, kind="gbm", groups=tuple(features.GROUPS), feature=None, seed=0):
    """Fit a risk model on converged tier-1 shots. y marks the logically wrong ones."""
    keep = F[:, CONVERGED] > 0
    F, y = np.asarray(F[keep], np.float64), np.asarray(y[keep], bool)
    if kind == "heuristic":
        column = features.NAMES.index(feature)
        x = F[:, column]
        sign = 1.0 if x[y].mean() >= x[~y].mean() else -1.0
        return RiskModel(kind, [column], coef=np.array([sign]), mean=np.array([x.mean()]), scale=np.array([x.std() + 1e-9]),
                         meta={"feature": feature})
    columns = [c for c in features.columns_of(groups) if c != CONVERGED]
    x = F[:, columns]
    if kind == "logistic":
        mean, scale = x.mean(axis=0), x.std(axis=0) + 1e-9
        fit = LogisticRegression(C=1.0, class_weight="balanced", max_iter=2000).fit((x - mean) / scale, y)
        return RiskModel(kind, columns, coef=fit.coef_[0], mean=mean, scale=scale, intercept=float(fit.intercept_[0]),
                         meta={"groups": list(groups)})
    if kind == "gbm":
        fit = HistGradientBoostingClassifier(max_iter=150, max_depth=4, learning_rate=0.06, l2_regularization=1.0,
                                             class_weight="balanced", early_stopping=False, random_state=seed).fit(x, y)
        return RiskModel(kind, columns, estimator=fit, meta={"groups": list(groups)})
    raise ValueError(kind)


def calibrate(model, F, y):
    """Platt scaling on held-out shots: fit risk = sigmoid(a * score + b). Returns the model."""
    keep = F[:, CONVERGED] > 0
    scores, labels = model.scores(F[keep]).reshape(-1, 1), np.asarray(y[keep], bool)
    if labels.all() or not labels.any():
        return model          # nothing to calibrate against; the scores stay as they are
    fit = LogisticRegression(C=1e6, max_iter=2000).fit(scores, labels)
    model.platt = (float(fit.coef_[0, 0]), float(fit.intercept_[0]))
    return model


def quality(model, F, y, bins=10):
    """How well the model ranks and calibrates on converged shots."""
    keep = F[:, CONVERGED] > 0
    risk, y = model.risks(F[keep]), np.asarray(y[keep], bool)
    if y.all() or not y.any():
        return {"shots": int(len(y)), "wrong": int(y.sum())}
    # Expected calibration error over equal-count bins of the predicted risk.
    order = np.argsort(risk)
    ece = sum(abs(risk[part].mean() - y[part].mean()) * len(part) for part in np.array_split(order, bins)) / len(y)
    return {"shots": int(len(y)), "wrong": int(y.sum()), "auc": float(roc_auc_score(y, risk)),
            "average_precision": float(average_precision_score(y, risk)), "brier": float(np.mean((risk - y) ** 2)),
            "ece": float(ece), "mean_risk": float(risk.mean()), "base_rate": float(y.mean())}
