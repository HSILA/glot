#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$HOME/glot"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.prod.yml"

cd "$DEPLOY_DIR"

# Timestamped logs are printed to stdout so GitHub Actions captures them from
# the remote SSH deploy step.
timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

log() {
  echo "$(timestamp) $*"
}

DEPLOY_STARTED_AT=$(date +%s)
STEP_STARTED_AT=$DEPLOY_STARTED_AT
CURRENT_STEP="deploy initialization"

finish_step() {
  local finished_at
  finished_at=$(date +%s)
  log "✓ ${CURRENT_STEP} complete duration=$((finished_at - STEP_STARTED_AT))s"
}

fail_step() {
  local failed_at
  failed_at=$(date +%s)
  log "✗ ${CURRENT_STEP} failed duration=$((failed_at - STEP_STARTED_AT))s total=$((failed_at - DEPLOY_STARTED_AT))s"
}

start_step() {
  CURRENT_STEP="$1"
  STEP_STARTED_AT=$(date +%s)
  log "${CURRENT_STEP} started"
}

on_error() {
  local status=$?
  fail_step
  exit "$status"
}
trap on_error ERR

# Prevent concurrent deploys
exec 9>/tmp/glot-deploy.lock
flock -n 9 || { log "Deploy already in progress — aborting"; exit 1; }

# Validate required env vars before doing anything
: "${REGISTRY_TOKEN:?must be set in environment}"

# Accept optional GLOT_VERSION env var (semver from CI, e.g. 0.2.0)
# Falls back to :latest if not set
export GLOT_VERSION="${GLOT_VERSION:-latest}"

log "=== Glot Deploy started version=$GLOT_VERSION ==="

start_step "[1/9] Logging in to GHCR"
echo "$REGISTRY_TOKEN" | docker login ghcr.io -u hsilabot --password-stdin
finish_step

start_step "[2/9] Pulling images tag=$GLOT_VERSION"
docker compose -f "$COMPOSE_FILE" pull
finish_step

start_step "[3/9] Stopping and removing old containers"
docker compose -f "$COMPOSE_FILE" down --remove-orphans
finish_step

start_step "[4/9] Running database migrations"
# This script is streamed to the remote shell as stdin
# (`bash < scripts/deploy.sh`). `docker compose run` can still attach to stdin
# even with `-T`, and then consume the rest of this script before bash can read
# the service startup and health-check steps. Redirect stdin from /dev/null for
# every one-off compose container so migrations cannot drain the deploy script.
docker compose -f "$COMPOSE_FILE" run -T --rm backend uv run alembic upgrade head < /dev/null
finish_step

start_step "[5/9] Starting services"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
finish_step

start_step "[6/9] Health check backend"
HEALTH_OK=false
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8000/docs > /dev/null 2>&1; then
    log "  ✓ Backend is healthy attempt=$i"
    HEALTH_OK=true
    break
  fi
  if [ "$i" -eq 30 ]; then
    log "  ✗ Backend health check failed after 30 attempts"
    break
  fi
  sleep 2
done

if [ "$HEALTH_OK" = "false" ]; then
  log "  ✗ Deploy failed — backend unhealthy"
  docker compose -f "$COMPOSE_FILE" logs --tail=50 backend || true
  fail_step
  # Do not rollback: alembic already migrated the DB, old code may conflict
  # with the new schema.  Leave containers down and alert.
  exit 1
fi
finish_step

start_step "[7/9] Health check frontend"
FRONTEND_OK=false
for i in $(seq 1 15); do
  if curl -sf http://127.0.0.1:3000 > /dev/null 2>&1; then
    log "  ✓ Frontend is healthy attempt=$i"
    FRONTEND_OK=true
    break
  fi
  if [ "$i" -eq 15 ]; then
    log "  ✗ Frontend health check failed after 15 attempts"
    break
  fi
  sleep 2
done

if [ "$FRONTEND_OK" = "false" ]; then
  log "  ✗ Deploy failed — frontend unhealthy"
  docker compose -f "$COMPOSE_FILE" logs --tail=50 frontend || true
  fail_step
  exit 1
fi
finish_step

start_step "[8/9] Health check worker"
if ! docker compose -f "$COMPOSE_FILE" ps --status running --services 2>/dev/null | grep -q '^worker$'; then
  log "  ✗ Worker not running"
  docker compose -f "$COMPOSE_FILE" logs --tail=50 worker || true
  fail_step
  exit 1
fi
log "  ✓ Worker is running"
finish_step

start_step "[9/9] Cleaning old images and build cache"
docker image prune -a -f
docker builder prune -f
finish_step

DEPLOY_FINISHED_AT=$(date +%s)
log "=== Deploy complete version=$GLOT_VERSION total=$((DEPLOY_FINISHED_AT - DEPLOY_STARTED_AT))s ==="
