#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$HOME/glot"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.prod.yml"

# Accept optional GLOT_VERSION env var (semver from CI, e.g. 0.2.0)
# Falls back to :latest if not set
export GLOT_VERSION="${GLOT_VERSION:-latest}"

echo "=== Glot Deploy (version: $GLOT_VERSION) ==="

echo "[1/7] Logging in to GHCR..."
echo "$REGISTRY_TOKEN" | docker login ghcr.io -u hsilabot --password-stdin

echo "[2/7] Capturing current image tags for rollback..."
OLD_BACKEND_TAG=$(docker inspect --format='{{.Config.Image}}' glot-backend 2>/dev/null || echo "none")
OLD_FRONTEND_TAG=$(docker inspect --format='{{.Config.Image}}' glot-frontend 2>/dev/null || echo "none")
echo "  Previous backend: $OLD_BACKEND_TAG"
echo "  Previous frontend: $OLD_FRONTEND_TAG"

echo "[3/7] Pulling images (tag: $GLOT_VERSION)..."
docker compose -f "$COMPOSE_FILE" pull

echo "[4/7] Running database migrations..."
docker compose -f "$COMPOSE_FILE" run --rm backend uv run alembic upgrade head

echo "[5/7] Restarting services..."
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

echo "[6/7] Health check..."
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
  echo "  ✗ Deploy failed — rolling back..."
  docker compose -f "$COMPOSE_FILE" logs --tail=50 backend
  if [ "$OLD_BACKEND_TAG" != "none" ]; then
    echo "  Reverting to previous images..."
    GLOT_VERSION="${OLD_BACKEND_TAG#*:}" docker compose -f "$COMPOSE_FILE" up -d
  fi
  exit 1
fi

echo "[7/7] Cleaning old images..."
docker image prune -a -f

echo "=== Deploy complete ==="