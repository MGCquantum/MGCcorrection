"""QEC-Aegis API: the local HTTP API behind the research lab (lab/, http://127.0.0.1:3100).

  python dashboard/server.py [--port 8765]

`/` redirects to the lab (LAB_URL); every `/api/*` route serves JSON over the real decoder and the
stored experiment records.

Standard library only, and offline: it binds to 127.0.0.1, makes no outgoing connection and
needs no account. Every payload carries a `source` label that the lab shows next to the data:

  live       computed now, on this machine, by the same code as the benchmarks
  stored     read from experiments/ (measured earlier; the record says when and how)
  reference  copied from the starter kit's README (not measured here)

Live decoding is bounded to the kit's noise strengths, one shot per request.
"""
import argparse
import json
import os
import sys

# Request threads must not start OpenMP thread pools (see aegis/model.py). Set before numpy loads.
os.environ.setdefault("OMP_NUM_THREADS", "1")
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from aegis import features  # noqa: E402
from aegis.decoder import AegisDecoder, load_model  # noqa: E402
from aegis.problem import Problem  # noqa: E402
from aegis.tiers import build  # noqa: E402

import lab_api  # noqa: E402  (read-only payloads for the research-lab frontend in lab/)

MODELS = ROOT / "models"
REPORTS = ROOT / "experiments" / "reports"
FIGURES = ROOT / "docs" / "figures"
ALLOWED_P = [0.003, 0.004, 0.005]
ALLOWED_F = [0.0, 0.25, 0.5, 0.75]
# Starter-kit README, "Reference results with 10,000 shots per basis". Not measured on this machine.
REFERENCE = [
    {"p": 0.003, "decoder": "BP-OSD", "failures": "26, 30", "ler": 4.7e-4, "mean_s": 0.14},
    {"p": 0.003, "decoder": "relay-BP", "failures": "3, 2", "ler": 4.2e-5, "mean_s": 0.10},
    {"p": 0.004, "decoder": "BP-OSD", "failures": "253, 269", "ler": 4.4e-3, "mean_s": 0.33},
    {"p": 0.004, "decoder": "relay-BP", "failures": "45, 60", "ler": 8.7e-4, "mean_s": 0.38},
    {"p": 0.005, "decoder": "BP-OSD", "failures": "1302, 1286", "ler": 2.3e-2, "mean_s": 0.59},
    {"p": 0.005, "decoder": "relay-BP", "failures": "411, 414", "ler": 6.9e-3, "mean_s": 1.7},
]
_cache, _lock = {}, threading.Lock()
# The research lab (lab/, port 3100) is the user-facing dashboard; / sends the browser there.
LAB_URL = os.environ.get("LAB_URL", "http://127.0.0.1:3100/")
LAB_ROUTES = {"/api/gross/structure": lab_api.gross_structure, "/api/records": lab_api.records_summary,
              "/api/manifest": lab_api.manifest, "/api/calibration": lab_api.calibration,
              "/api/training": lab_api.training, "/api/pipeline": lab_api.pipeline,
              "/api/evaluation": lab_api.evaluation, "/api/methods": lab_api.methods}


def model_for(f):
    """The routed decoder's risk model, or None when it has not been trained yet.

    Under erasure only a model trained on erasure data is used: the sweep model never saw herald
    flags, so its loss features would be out of range. A model file that is replaced (for example
    by `make train`) is reloaded on the next request.
    """
    path = MODELS / ("aegis_router_loss.joblib" if f else "aegis_router.joblib")
    if not path.exists():
        return None
    stamp = path.stat().st_mtime
    cached = _cache.get(path.name)
    if cached is None or cached[0] != stamp:
        try:
            _cache[path.name] = (stamp, load_model(path))
        except Exception:          # a file being written right now; keep what we had
            return cached[1] if cached else None
    return _cache[path.name][1]


def setup(basis, p, f):
    """Problem and decoders of one setting, built once and kept. QEC-Aegis follows the model file."""
    key = (basis, p, f)
    if key not in _cache:
        problem = Problem(basis, p, f)
        flags = "+flags" if f else ""
        _cache[key] = {"problem": problem, "model": None, "aegis": None,
                       "relay": build("relay" + flags, problem), "bposd": build("bposd" + flags, problem)}
    s = _cache[key]
    model = model_for(f)
    if model is None:
        s["model"] = s["aegis"] = None
    elif s["model"] is not model:
        s["model"], s["aegis"] = model, AegisDecoder(s["problem"], model, use_flags=bool(f))
    return s


def decode_live(basis, p, f, seed, baselines):
    """Sample one shot and decode it. Everything returned was computed in this call."""
    if basis not in ("X", "Z") or p not in ALLOWED_P or f not in ALLOWED_F:
        raise ValueError(f"allowed: basis X or Z, p in {ALLOWED_P}, erasure fraction in {ALLOWED_F}")
    with _lock:
        s = setup(basis, p, f)
        problem, model = s["problem"], s["model"]
        syndromes, other, obs, fired = problem.sample(1, int(seed))
        syndrome, truth = syndromes[0], obs[0]

        def outcome(result, seconds):
            predicted = (problem.L @ result.error) % 2
            return {"logical_correct": bool((predicted == truth).all()), "ms": seconds * 1e3,
                    "explains_syndrome": bool(((problem.H @ result.error) % 2 == syndrome).all()),
                    "bp_iterations": int(result.iterations), "predicted_observables": predicted.tolist()}

        for name in ("aegis", "relay", "bposd"):
            if s[name] is not None:
                s[name].reset()      # the same seed then gives the same answers, whatever was decoded before
        decoders, routing, shot_features = {}, None, None
        if s["aegis"] is not None:
            start = time.perf_counter()
            result = s["aegis"].decode_shot(syndrome, int(other[0].sum()), fired[0])
            decoders["QEC-Aegis"] = outcome(result, time.perf_counter() - start)
            converged = bool(result.features[0])
            routing = {"risk": result.risk, "threshold": model.meta["threshold"], "escalated": bool(result.escalated),
                       "tier1": model.meta["tier1"], "tier2": model.meta["tier2"], "tier1_converged": converged,
                       "path": ("tier 1 -> tier 2 (tier 1 did not converge)" if result.escalated and not converged
                                else "tier 1 -> tier 2 (risk above threshold)" if result.escalated else "tier 1 accepted"),
                       "ms_tier1": result.seconds_tier1 * 1e3, "ms_model": result.seconds_model * 1e3,
                       "ms_tier2": result.seconds_tier2 * 1e3, "model": model.meta.get("name", model.kind),
                       "trained_on": model.meta.get("trained_on")}
            shot_features = dict(zip(features.NAMES, (float(v) for v in result.features)))
        for name, label in (("relay", "relay-BP"), ("bposd", "BP-OSD")):
            if name in baselines:
                start = time.perf_counter()
                baseline = s[name].decode_shot(syndrome, int(other[0].sum()), fired[0])
                decoders[label] = outcome(baseline, time.perf_counter() - start)
        # Heralds per syndrome round: a herald's detector id grows with time in the circuit.
        herald_rounds = np.zeros(problem.rounds, int)
        if len(fired[0]):
            position = np.searchsorted(problem.herald_ids, fired[0]) / max(len(problem.herald_ids), 1)
            np.add.at(herald_rounds, np.minimum((position * problem.rounds).astype(int), problem.rounds - 1), 1)
        return {
            "source": "live", "basis": basis, "p": p, "f": f, "seed": int(seed),
            "syndrome": syndrome.reshape(problem.rounds, problem.checks).tolist(),
            "true_observables": truth.tolist(), "heralds": int(len(fired[0])), "herald_rounds": herald_rounds.tolist(),
            "decoders": decoders, "routing": routing, "features": shot_features, "feature_groups": features.GROUPS,
            "aegis_available": routing is not None,
        }


def stored_studies():
    """Decoder studies on validation shots (aegis.study, aegis.predecoder), oldest setting first."""
    studies = []
    for path in sorted(REPORTS.glob("complementarity_p*.json")):
        report = json.loads(path.read_text())
        report["written"] = time.strftime("%Y-%m-%d %H:%M", time.localtime(path.stat().st_mtime))
        studies.append(report)
    path = REPORTS / "predecoder_p0.004.json"
    predecoder = json.loads(path.read_text()) if path.exists() else None
    return studies, predecoder


def stored_results():
    """The measured evaluation, as written by aegis.evaluate, and the validation studies."""
    studies, predecoder = stored_studies()
    path = REPORTS / "evaluation.json"
    if not path.exists():
        return {"source": "stored", "available": False, "studies": studies, "predecoder": predecoder}
    report = json.loads(path.read_text())
    slim = {key: {setting: {k: v for k, v in result.items() if k != "frontier"} for setting, result in report.get(key, {}).items()}
            for key in ("sweep", "timing", "loss")}
    return {"source": "stored", "available": True, "written": time.strftime("%Y-%m-%d %H:%M", time.localtime(path.stat().st_mtime)),
            "model": report["model"], **slim, "studies": studies, "predecoder": predecoder,
            "figures": sorted(f.name for f in FIGURES.glob("*.png")) if FIGURES.exists() else []}


class Handler(BaseHTTPRequestHandler):
    def send(self, body, kind="application/json", status=200):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            self.send_response(302)
            self.send_header("Location", LAB_URL)
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif path == "/api/status":
            model, loss_model = model_for(0.0), model_for(0.5)
            meta = lambda m: None if m is None else {k: v for k, v in m.meta.items() if k != "feature_names"} | {"kind": m.kind}
            self.send({"source": "live", "offline": True, "allowed_p": ALLOWED_P, "allowed_f": ALLOWED_F,
                       "model": meta(model), "loss_model": meta(loss_model)})
        elif path == "/api/results":
            self.send(stored_results())
        elif path == "/api/reference":
            self.send({"source": "reference", "origin": "challenge-1-ml-decoder-kit/README.md", "rows": REFERENCE})
        elif path in LAB_ROUTES:
            try:
                self.send(LAB_ROUTES[path]())
            except Exception as error:
                self.send({"error": f"{type(error).__name__}: {str(error)[:300]}"}, status=500)
        elif path.startswith("/figures/") and (FIGURES / Path(path).name).is_file() and path.endswith(".png"):
            self.send((FIGURES / Path(path).name).read_bytes(), "image/png")
        else:
            self.send({"error": "not found"}, status=404)

    def do_POST(self):
        if self.path != "/api/decode":
            return self.send({"error": "not found"}, status=404)
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            self.send(decode_live(body.get("basis", "X"), float(body.get("p", 0.004)), float(body.get("f", 0.0)),
                                  int(body.get("seed", 1)), body.get("baselines", ["relay", "bposd"])))
        except (ValueError, KeyError, TypeError) as error:
            self.send({"error": str(error)}, status=400)

    def log_message(self, *args):
        pass


def serve(port=8765):
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="do not open the research lab in a browser")
    args = parser.parse_args()
    server = serve(args.port)
    print(f"QEC-Aegis API at http://127.0.0.1:{args.port}/api/status (local only; Ctrl-C to stop). Dashboard: {LAB_URL}")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, [LAB_URL]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
