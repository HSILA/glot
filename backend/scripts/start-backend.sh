#!/usr/bin/env bash
set -euo pipefail

BASELINE_REVISION="${ALEMBIC_BASELINE_REVISION:-0001_baseline}"

echo "[startup] Checking database migration state..."
ACTION="$(uv run python scripts/alembic_bootstrap.py)"

case "${ACTION}" in
  stamp_baseline)
    echo "[startup] Existing schema detected without Alembic history. Stamping ${BASELINE_REVISION}..."
    uv run alembic stamp "${BASELINE_REVISION}"
    ;;
  manual_required)
    echo "[startup] Existing schema is not compatible for automatic baseline stamping."
    echo "[startup] Manual migration intervention required. Refusing to start backend."
    exit 1
    ;;
  upgrade)
    ;;
  *)
    echo "[startup] Unknown bootstrap action: ${ACTION}"
    exit 1
    ;;
esac

echo "[startup] Running Alembic migrations..."
uv run alembic upgrade head

echo "[startup] Starting API server..."
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
