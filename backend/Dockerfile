# Backend Dockerfile for FastAPI with uv
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Set working directory
WORKDIR /app

# Copy dependency and migration config first (for better caching)
COPY pyproject.toml uv.lock README.md alembic.ini ./

# Install dependencies
RUN uv sync --frozen --no-dev

# Copy application, migrations, and scripts
COPY app ./app
COPY alembic ./alembic
COPY scripts ./scripts

# Expose port
EXPOSE 8000

# Run migration bootstrap + alembic upgrade, then start API
CMD ACTION="$(uv run python scripts/alembic_bootstrap.py)" \
    && if [ "$ACTION" = "stamp_baseline" ]; then \
         uv run alembic stamp "${ALEMBIC_BASELINE_REVISION:-0001_baseline}"; \
       elif [ "$ACTION" = "manual_required" ]; then \
         echo "[startup] Existing schema is not compatible for automatic baseline stamping."; \
         echo "[startup] Manual migration intervention required. Refusing to start backend."; \
         exit 1; \
       elif [ "$ACTION" != "upgrade" ]; then \
         echo "[startup] Unknown bootstrap action: $ACTION"; \
         exit 1; \
       fi \
    && uv run alembic upgrade head \
    && exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
