# Glot - Personal Spaced Repetition PWA
# https://github.com/casey/just

# Default recipe - show available commands
default:
    @just --list

# ─────────────────────────────────────────────────────────────
# Development (local, no Docker)
# ─────────────────────────────────────────────────────────────

# Install all dependencies
install:
    cd backend && uv sync
    cd frontend && bun install

# Start backend in dev mode (requires db-up first)
dev-backend:
    cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0

# Start frontend in dev mode
dev-frontend:
    cd frontend && bun run dev

# Start both backend and frontend (in separate terminals, requires db-up)
dev:
    @echo "Starting backend and frontend..."
    @just dev-backend &

# Start background worker locally
worker:
    cd backend && uv run arq app.workers.extraction_worker.WorkerSettings

# ─────────────────────────────────────────────────────────────
# Docker
# ─────────────────────────────────────────────────────────────

# Build all Docker images
build:
    docker compose build

# Start all services with Docker
up:
    docker compose up -d

# Start all services and follow logs
up-logs:
    docker compose up

# Stop all services
down:
    docker compose down

# View logs for all services
logs:
    docker compose logs -f

# View logs for specific service (usage: just logs-svc backend)
logs-svc service:
    docker compose logs -f {{ service }}

# Restart all services
restart:
    docker compose restart

# ─────────────────────────────────────────────────────────────
# Database
# ─────────────────────────────────────────────────────────────

# Start only database services (postgres, redis, adminer)
db-up:
    docker compose up -d postgres redis adminer

# Stop database services
db-down:
    docker compose down postgres redis adminer

# Create the database (run once after db-up)
db-init:
    docker exec glot-postgres psql -U postgres -c "CREATE DATABASE glot;"

# Open PostgreSQL shell
db-shell:
    docker exec -it glot-postgres psql -U postgres -d glot

# Reset database (warning: deletes all data)
db-reset:
    docker compose down -v postgres
    docker compose up -d postgres

# Open Redis CLI
redis-shell:
    docker exec -it glot-redis redis-cli

# ─────────────────────────────────────────────────────────────
# Quality
# ─────────────────────────────────────────────────────────────

# Run backend linter
lint:
    cd backend && uv run ruff check .

# Run backend tests
test:
    cd backend && uv run pytest

# Run all checks (lint + test)
check:
    @just lint
    @just test

# ─────────────────────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────────────────────

# Show service status
status:
    docker compose ps

# Clean up Docker resources (volumes, images, etc.)
clean:
    docker compose down -v --rmi local
    @echo "Cleaned up Docker volumes and local images"
