#!/usr/bin/env bash
# Copies deploy/updates/ into the Storybook Pages artifact before upload. A
# repository has one Pages deployment, so the manifest release.yml commits to
# main has to ride inside this artifact — otherwise the next unrelated merge
# to main redeploys Pages without it and every instance's update check flips
# to failed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$REPO_ROOT/packages/workbench/storybook-static/updates"

mkdir -p "$REPO_ROOT/deploy/updates" "$TARGET"
cp -r "$REPO_ROOT/deploy/updates/." "$TARGET/"
