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
		-f "$DEPLOY_DIR/docker-compose.dovecot.yml" \
		-f "$DEPLOY_DIR/docker-compose.e2e.yml" \
		"$@"
}

# Both compose interpolation and every service's `env_file: .env` read this
# path, so the run configures itself from one committed file.
#
# Anything in E2E_OVERRIDABLE that is already set in the caller's environment is
# appended afterwards, and the later assignment wins for both readers. That is
# what lets a post-publish CI job pin REMIT_TAG to the digest it just built
# instead of racing whatever `latest` resolves to, and lets a second run on one
# machine move its ports.
E2E_OVERRIDABLE=(REMIT_TAG E2E_HTTP_PORT E2E_IMAP_PORT)

e2e_install_env() {
	cp "$DEPLOY_DIR/e2e.env" "$DEPLOY_DIR/.env"

	for name in "${E2E_OVERRIDABLE[@]}"; do
		[ -n "${!name-}" ] || continue
		printf '%s=%s\n' "$name" "${!name}" >>"$DEPLOY_DIR/.env"
		echo "e2e: $name overridden to ${!name}"
	done

	# PUBLIC_ORIGIN has to follow the published port, or better-auth rejects the
	# browser's Origin and every UI spec fails on sign-in.
	if [ -n "${E2E_HTTP_PORT-}" ]; then
		printf 'PUBLIC_ORIGIN=http://localhost:%s\n' "$E2E_HTTP_PORT" >>"$DEPLOY_DIR/.env"
	fi
}
