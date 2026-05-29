#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$HOME/glot"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.prod.yml"

cd "$DEPLOY_DIR"

# Prevent concurrent deploys
exec 9>/tmp/glot-deploy.lock
flock -n 9 || { echo "Deploy already in progress — aborting"; exit 1; }

# Validate required env vars before doing anything
: "${REGISTRY_TOKEN:?must be set in environment}"

# Accept optional GLOT_VERSION env var (semver from CI, e.g. 0.2.0)
# Falls back to :latest if not set
export GLOT_VERSION="${GLOT_VERSION:-latest}"

echo "=== Glot Deploy (version: $GLOT_VERSION) ==="

echo "[1/9] Logging in to GHCR..."
echo "$REGISTRY_TOKEN" | docker login ghcr.io -u hsilabot --password-stdin

echo "[2/9] Pulling images (tag: $GLOT_VERSION)..."
docker compose -f "$COMPOSE_FILE" pull

echo "[3/9] Stopping and removing old containers..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans

echo "[4/9] Running database migrations..."
docker compose -f "$COMPOSE_FILE" run --rm backend uv run alembic upgrade head

echo "[5/9] Starting services..."
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

echo "[6/9] Health check (backend)..."
HEALTH_OK=false
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8000/docs > /dev/null 2>&1; then
    echo "  ✓ Backend is healthy"
    HEALTH_OK=true
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  ✗ Backend health check failed after 30 attempts"
  fi
  sleep 2
done

if [ "$HEALTH_OK" = "false" ]; then
  echo "  ✗ Deploy failed — backend unhealthy"
  docker compose -f "$COMPOSE_FILE" logs --tail=50 backend
  # Do not rollback: alembic already migrated the DB, old code may conflict
  # with the new schema.  Leave containers down and alert.
  exit 1
fi

echo "[7/9] Health check (frontend)..."
FRONTEND_OK=false
for i in $(seq 1 15); do
  if curl -sf http://127.0.0.1:3000 > /dev/null 2>&1; then
    echo "  ✓ Frontend is healthy"
    FRONTEND_OK=true
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "  ✗ Frontend health check failed after 15 attempts"
  fi
  sleep 2
done

if [ "$FRONTEND_OK" = "false" ]; then
  echo "  ✗ Deploy failed — frontend unhealthy"
  docker compose -f "$COMPOSE_FILE" logs --tail=50 frontend
  exit 1
fi

echo "[8/9] Health check (worker)..."
if ! docker compose -f "$COMPOSE_FILE" ps --status running --services 2>/dev/null | grep -q '^worker$'; then
  echo "  ✗ Worker not running"
  docker compose -f "$COMPOSE_FILE" logs --tail=50 worker
  exit 1
fi
echo "  ✓ Worker is running"

echo "[9/9] Cleaning old images..."
docker image prune -a -f

echo "=== Deploy complete ==="