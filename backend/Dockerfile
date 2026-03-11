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

# Copy application, migrations, and startup scripts
COPY app ./app
COPY alembic ./alembic
COPY scripts ./scripts

RUN chmod +x ./scripts/start-backend.sh ./scripts/alembic_bootstrap.py

# Expose port
EXPOSE 8000

# Run migrations, then start API
CMD ["./scripts/start-backend.sh"]
