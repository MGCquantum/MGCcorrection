# QEC-Aegis. Every target runs locally; none contacts quantum hardware or a cloud service.
PY := .venv/bin/python

.PHONY: help setup test diagnose data train benchmark timing evaluate figures demo dev dev-stop evaluate-frozen lab-test study clean-checkpoints

help:
	@echo "make setup      create .venv from requirements.lock, run diagnostics and tests"
	@echo "make test       run all tests (about 2 minutes)"
	@echo "make data       decode training, calibration and validation shots (about 2.5 hours on 8 cores, resumable)"
	@echo "make train      train, calibrate and select the risk model from cached records (about 2 minutes)"
	@echo "make benchmark  decode the frozen test shots with every decoder, then evaluate (about 3.5 hours, resumable)"
	@echo "make timing     single-worker latency benchmark (about 45 minutes; run with nothing else running)"
	@echo "make evaluate   recompute all tables from cached records (seconds)"
	@echo "make figures    redraw docs/figures from the stored evaluation (seconds)"
	@echo "make dev        start the research lab at http://127.0.0.1:3100/ and its two API backends (make dev-stop stops them)"
	@echo "make demo       same as make dev"
	@echo "make evaluate-frozen  train, frozen test records, online run, timing, evaluate, figures (hours; resumable; progress in the lab)"
	@echo "make lab-test   lab type check, unit tests and browser end-to-end tests (needs make dev running)"

setup:
	./scripts/setup_env.sh

test:
	$(PY) -m pytest

diagnose:
	$(PY) scripts/diagnose.py

data:
	./scripts/run_experiments.sh data

study:
	$(PY) -m aegis.study

train:
	$(PY) -m aegis.train
	$(PY) -m aegis.train --loss

benchmark:
	./scripts/run_experiments.sh test
	./scripts/run_final.sh online
	$(PY) -m aegis.evaluate

timing:
	./scripts/run_final.sh timing
	$(PY) -m aegis.evaluate

evaluate:
	$(PY) -m aegis.evaluate

figures:
	$(PY) -m aegis.figures

dev:
	./scripts/dev.sh start

dev-stop:
	./scripts/dev.sh stop

demo: dev

evaluate-frozen:
	./scripts/run_frozen_evaluation.sh

lab-test:
	cd lab && npx tsc --noEmit && npx vitest run && npm run build && npx playwright test

clean-checkpoints:
	rm -rf data/checkpoints
