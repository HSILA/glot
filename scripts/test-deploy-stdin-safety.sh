#!/usr/bin/env bash
set -euo pipefail

# Regression test for SSH-streamed deploys:
#   ssh host 'bash' < scripts/deploy.sh
# If a nested command such as `docker compose run` reads from stdin, it can drain
# the rest of deploy.sh before bash reaches service startup and health checks.
# This test uses a fake docker CLI that intentionally drains stdin during
# `docker compose run`. The deploy must still reach "Deploy complete".

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP_DIR=$(mktemp -d)
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/home/glot"
cp "$ROOT_DIR/scripts/deploy.sh" "$TMP_DIR/home/glot/deploy.sh"
touch "$TMP_DIR/home/glot/docker-compose.prod.yml"

cat > "$TMP_DIR/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "login" ]; then
  # Consume only the password pipe, not the deploy script stdin.
  cat >/dev/null
  echo "fake docker login"
  exit 0
fi

if [ "${1:-}" = "compose" ]; then
  shift
  # Skip compose-global flags and their values.
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -f|--file|--project-name|-p)
        shift 2
        ;;
      --*)
        shift
        ;;
      *)
        break
        ;;
    esac
  done

  cmd="${1:-}"
  shift || true
  case "$cmd" in
    pull|down|up)
      echo "fake compose $cmd"
      ;;
    run)
      # Simulate the bug: compose run attaches to stdin and drains everything
      # available. deploy.sh must protect itself with `< /dev/null` so this
      # cannot consume the remaining script.
      cat >/dev/null
      echo "fake compose run drained stdin"
      ;;
    ps)
      echo "worker"
      ;;
    logs)
      echo "fake logs"
      ;;
    *)
      echo "unexpected compose command: $cmd" >&2
      exit 64
      ;;
  esac
  exit 0
fi

if [ "${1:-}" = "image" ] && [ "${2:-}" = "prune" ]; then
  echo "fake image prune"
  exit 0
fi

if [ "${1:-}" = "builder" ] && [ "${2:-}" = "prune" ]; then
  echo "fake builder prune"
  exit 0
fi

echo "unexpected docker args: $*" >&2
exit 64
FAKE_DOCKER
chmod +x "$TMP_DIR/bin/docker"

cat > "$TMP_DIR/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
exit 0
FAKE_CURL
chmod +x "$TMP_DIR/bin/curl"

cat > "$TMP_DIR/bin/sleep" <<'FAKE_SLEEP'
#!/usr/bin/env bash
exit 0
FAKE_SLEEP
chmod +x "$TMP_DIR/bin/sleep"

OUTPUT=$(
  HOME="$TMP_DIR/home" \
  PATH="$TMP_DIR/bin:$PATH" \
  REGISTRY_TOKEN=x \
  GLOT_VERSION="test-version" \
  bash < "$TMP_DIR/home/glot/deploy.sh"
)

printf '%s\n' "$OUTPUT"

grep -q '\[5/9\] Starting services started' <<<"$OUTPUT"
grep -q '\[6/9\] Health check backend started' <<<"$OUTPUT"
grep -q '\[7/9\] Health check frontend started' <<<"$OUTPUT"
grep -q '\[8/9\] Health check worker started' <<<"$OUTPUT"
grep -q '\[9/9\] Cleaning old images and build cache started' <<<"$OUTPUT"
grep -q '=== Deploy complete version=test-version' <<<"$OUTPUT"

echo "deploy stdin safety regression passed"
