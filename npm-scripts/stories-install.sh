#!/usr/bin/env bash
# The browser the story suite renders in. Vitest browser mode launches
# `playwright.chromium`, which is the full Chromium build and not the headless
# shell the e2e suite fetches — a shell-only install leaves the launch with
# nothing to start.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

./node_modules/.bin/playwright install --with-deps chromium
