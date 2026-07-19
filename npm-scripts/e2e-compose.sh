#!/usr/bin/env bash
# Shared by e2e-up.sh / e2e-down.sh / e2e-test.sh. Sourced, never run.
#
# `docker compose` is invoked from deploy/vps so the base file's relative bind
# mounts resolve, and always with both files: the overlay alone is not a stack.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy/vps"

e2e_compose() {
	docker compose \
		--project-directory "$DEPLOY_DIR" \
		-f "$DEPLOY_DIR/docker-compose.sqlite.yml" \
		-f "$DEPLOY_DIR/docker-compose.e2e.yml" \
		"$@"
}

# Both compose interpolation and every service's `env_file: .env` read this
# path, so the run configures itself from one committed file.
e2e_install_env() {
	cp "$DEPLOY_DIR/e2e.env" "$DEPLOY_DIR/.env"
}
