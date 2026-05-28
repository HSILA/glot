# Backend Dockerfile for FastAPI with uv
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (pinned version)
COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /usr/local/bin/uv

# Create non-root user
RUN groupadd --gid 1001 appgroup && \
    useradd --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser

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

# Set ownership
RUN chown -R appuser:appgroup /app

USER appuser

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
