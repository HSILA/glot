#!/usr/bin/env bash
set -euo pipefail

BASELINE_REVISION="${ALEMBIC_BASELINE_REVISION:-0001_baseline}"

echo "[startup] Checking database migration state..."
ACTION="$(uv run python scripts/alembic_bootstrap.py)"

if [[ "${ACTION}" == "stamp_baseline" ]]; then
  echo "[startup] Existing schema detected without Alembic history. Stamping ${BASELINE_REVISION}..."
  uv run alembic stamp "${BASELINE_REVISION}"
fi

echo "[startup] Running Alembic migrations..."
uv run alembic upgrade head

echo "[startup] Starting API server..."
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
