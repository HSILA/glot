#!/usr/bin/env bash
set -euo pipefail

# Validate commit messages follow:
#   <type>: <title>
#   <empty line>
#   - bullet
#   - bullet
#
# Allowed types: fix|feature|chore|style|refactor|docs|test|perf|build|ci|revert

allowed_types_regex='^(fix|feature|chore|style|refactor|docs|test|perf|build|ci|revert): .+'

validate_message_text() {
  local text="$1"

  # Strip trailing CRs for Windows checkouts
  text="$(printf '%s' "$text" | sed 's/\r$//g')"

  local first second rest
  first="$(printf '%s' "$text" | sed -n '1p')"
  second="$(printf '%s' "$text" | sed -n '2p')"
  rest="$(printf '%s' "$text" | sed -n '3,$p')"

  if ! printf '%s' "$first" | grep -Eq "$allowed_types_regex"; then
    echo "ERROR: First line must match '<type>: <title>' with allowed types." >&2
    echo "  Allowed types: fix, feature, chore, style, refactor, docs, test, perf, build, ci, revert" >&2
    echo "  Got: $first" >&2
    return 1
  fi

  if [ -n "$second" ]; then
    echo "ERROR: Second line must be empty." >&2
    echo "  Got: $second" >&2
    return 1
  fi

  # If there is a body, every non-empty line must be a markdown bullet.
  if [ -n "$(printf '%s' "$rest" | sed '/^[[:space:]]*$/d')" ]; then
    local bad
    bad="$(printf '%s' "$rest" \
      | sed 's/[[:space:]]\+$//' \
      | awk 'NF && $0 !~ /^- / { print }')"

    if [ -n "$bad" ]; then
      echo "ERROR: Commit body lines must be markdown bullets starting with '- '." >&2
      echo "Bad lines:" >&2
      echo "$bad" >&2
      return 1
    fi
  fi
}

validate_commit_range() {
  local range="$1"

  # For each commit, validate the message.
  local sha
  while IFS= read -r sha; do
    # Full message (subject + body)
    local msg
    msg="$(git show -s --format=%B "$sha")"
    if ! validate_message_text "$msg"; then
      echo "Commit failed validation: $sha" >&2
      return 1
    fi
  done < <(git rev-list "$range")
}

main() {
  if [ "$#" -eq 0 ]; then
    echo "Usage: $0 <commit-msg-file>|--range <rev-range>" >&2
    exit 2
  fi

  if [ "$1" = "--range" ]; then
    [ "$#" -eq 2 ] || { echo "Usage: $0 --range <rev-range>" >&2; exit 2; }
    validate_commit_range "$2"
    exit 0
  fi

  local file="$1"
  [ -f "$file" ] || { echo "ERROR: file not found: $file" >&2; exit 2; }
  validate_message_text "$(cat "$file")"
}

main "$@"
