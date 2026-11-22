#!/usr/bin/env bash
# Create the project environment (.venv, Python 3.12) and verify it.
#
#   ./scripts/setup_env.sh            exact versions from requirements.lock
#   ./scripts/setup_env.sh --latest   newest versions allowed by requirements-dev.txt
#
# Needs: Python 3.12 (python3.12 on PATH, or set PYTHON=/path/to/python) and a Rust toolchain
# for relay-bp (https://rustup.rs). Installs nothing outside this repository.
set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python3.12}"
command -v "$PYTHON" >/dev/null || { echo "Python 3.12 not found. Install it or set PYTHON=/path/to/python3.12" >&2; exit 1; }
# A toolchain installed into .toolchain/ (see docs/SETUP.md) is used when Rust is not on PATH.
if ! command -v cargo >/dev/null && [ -x .toolchain/cargo/bin/cargo ]; then
  export RUSTUP_HOME="$PWD/.toolchain/rustup" CARGO_HOME="$PWD/.toolchain/cargo" PATH="$PWD/.toolchain/cargo/bin:$PATH"
fi
command -v cargo >/dev/null || { echo "Rust not found: relay-bp cannot be built. Install it from https://rustup.rs" >&2; exit 1; }

[ -d .venv ] || "$PYTHON" -m venv .venv
.venv/bin/python -m pip install --quiet --upgrade pip
if [ "${1:-}" = "--latest" ]; then
  .venv/bin/python -m pip install -r requirements-dev.txt
else
  .venv/bin/python -m pip install -r requirements.lock
fi
.venv/bin/python scripts/diagnose.py
.venv/bin/python -m pytest
