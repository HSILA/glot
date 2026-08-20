#!/usr/bin/env bash
set -euo pipefail

.venv/bin/python -m app.core.app_config

action="$(.venv/bin/python scripts/alembic_bootstrap.py)"
case "$action" in
  stamp_baseline)
    .venv/bin/alembic stamp "${ALEMBIC_BASELINE_REVISION:-0001_baseline}"
    ;;
  upgrade)
    ;;
  manual_required)
    echo "[startup] Existing schema requires manual migration intervention."
    exit 1
    ;;
  *)
    echo "[startup] Unknown bootstrap action: $action"
    exit 1
    ;;
esac

.venv/bin/alembic upgrade head
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
