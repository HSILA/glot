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
COPY config ./config

# Install dependencies
RUN uv sync --frozen --no-dev --no-install-project

# Copy application, canonical configuration, migrations, and scripts
COPY app ./app
COPY alembic ./alembic
COPY scripts ./scripts

# Set ownership
RUN chown -R appuser:appgroup /app

USER appuser

# Expose port
EXPOSE 8000

# Validate policy before touching the database, then migrate and start the API
CMD ["bash", "scripts/start_backend.sh"]
