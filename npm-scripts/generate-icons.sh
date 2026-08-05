#!/usr/bin/env bash
# Regenerate the web client's icon set from packages/web-client/brand/remit-mark.png.
#
# Run it when the mark changes and commit the result: the icons are static files
# in the served public dir, not a build step. Nothing in CI or the image build
# calls this.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec node "$REPO_ROOT/npm-scripts/generate-icons.mjs" "$REPO_ROOT"
