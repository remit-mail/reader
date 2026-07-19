#!/usr/bin/env bash
# Bring up the e2e stack and wait until it serves traffic.
set -euo pipefail

# shellcheck source=./e2e-compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-compose.sh"

e2e_install_env
# shellcheck disable=SC1091
set -a && source "$DEPLOY_DIR/.env" && set +a

echo "e2e: pulling published images"
e2e_compose pull --quiet

echo "e2e: starting stack"
e2e_compose up -d --wait --wait-timeout 180

base_url="http://localhost:${E2E_HTTP_PORT}"
echo "e2e: waiting for $base_url"
for _ in $(seq 1 60); do
	if curl -fsS -o /dev/null "$base_url/health" 2>/dev/null; then
		echo "e2e: stack is up at $base_url"
		exit 0
	fi
	sleep 1
done

echo "e2e: $base_url never became reachable" >&2
e2e_compose ps
exit 1
