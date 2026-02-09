#!/usr/bin/env bash
set -euo pipefail

# One-time setup for this repo: point git hooks to the tracked .githooks directory.

git config core.hooksPath .githooks

echo "Configured core.hooksPath to .githooks"
