#!/usr/bin/env bash
# Bring up the source-built e2e stack and wait until it serves traffic.
#
# Same deployment shape as `npm run e2e:up`, assembled from the worktree instead
# of from published images, and exporting the same E2E_* coordinates — so
# `npm run e2e:test` runs the same specs against either one.
set -euo pipefail

# shellcheck source=./e2e-dev-compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-dev-compose.sh"

# A leftover stack from an interrupted run would hold the ports and, worse,
# serve the previous run's database.
e2e_dev_stop_all
rm -rf "$DEV_STATE_DIR"

e2e_dev_install_env
e2e_dev_require_free_ports "$E2E_HTTP_PORT" "$E2E_IMAP_PORT" "$SERVER_PORT" "$QUEUE_SIDECAR_PORT"
mkdir -p "$STORAGE_LOCAL_PATH"

echo "e2e-dev: starting dovecot"
e2e_dev_compose up -d --wait --wait-timeout 120

echo "e2e-dev: starting the queue"
e2e_dev_start queue npm --prefix "$REPO_ROOT" run start -w @remit/queue-sidecar
e2e_dev_wait_for queue "http://127.0.0.1:${QUEUE_SIDECAR_PORT}/health" 60

# One migrator, ordered first, exactly as the compose stack's `migrate` one-shot
# runs before any app container — and the same artifact: the migrator imports its
# SQL as text, which only esbuild resolves, so this bundles the entrypoint the
# backend image bakes rather than running a second copy of it. Its drizzle
# folders are relative to deploy/vps, which is where the script runs it.
echo "e2e-dev: applying migrations"
npm --prefix "$REPO_ROOT" run e2e:dev:migrate

echo "e2e-dev: starting the backend and the imap worker"
e2e_dev_start backend npm --prefix "$REPO_ROOT" run serve -w @remit/backend
e2e_dev_start imap-worker npm --prefix "$REPO_ROOT" run dev -w @remit/imap-worker
e2e_dev_wait_for backend "http://127.0.0.1:${SERVER_PORT}/health" 90

echo "e2e-dev: starting the web client"
e2e_dev_start web npm --prefix "$REPO_ROOT" run dev -w @remit/web-client -- \
	--port "$E2E_HTTP_PORT" --host 127.0.0.1 --strictPort
e2e_dev_wait_for web "http://localhost:${E2E_HTTP_PORT}/config.js" 120

echo "e2e-dev: stack is up at http://localhost:${E2E_HTTP_PORT}"
