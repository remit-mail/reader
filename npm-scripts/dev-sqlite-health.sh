#!/usr/bin/env bash
# One command that says whether the dev:sqlite stack is serving.
#
# The stack degrades a service at a time and every existing surface keeps
# calling it fine: `docker compose ps` reports a crash-looping worker as up, a
# vite that answers 500 still holds its port, and a container running a module
# graph from a hundred commits ago looks exactly like one running the tip. The
# first report that anything was wrong was a user saying search could not find
# their mail.
#
# So this asks the three questions no single surface answers together — is every
# service up, is anything crash-looping, does the TLS front answer — names the
# one that failed, and exits non-zero. Read-only: it inspects the stack and
# never touches it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=npm-scripts/lib/dev-sqlite-health.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/dev-sqlite-health.sh"

COMPOSE_FILE="$REPO_ROOT/docker-compose.localhost-dev-sqlite.yml"
TLS_PROBE="$REPO_ROOT/npm-scripts/lib/dev-sqlite-tls-probe.mjs"
TLS_PORT="${REMIT_DEV_TLS_PORT:-4143}"
MAX_RESTARTS="${REMIT_DEV_MAX_RESTARTS:-5}"

usage() {
	cat <<'USAGE'
Usage: npm run dev:sqlite:health

Checks the stack docker-compose.localhost-dev-sqlite.yml describes, and exits
non-zero naming the check that failed:

  services   every service in the compose file is up — the migrator ran to
             completion, and anything carrying a healthcheck is healthy
  restarts   no service is crash-looping
  tls        the TLS front answers over TLS

A service running older code than the checkout is reported as a warning, not a
failure.

Environment:
  REMIT_DEV_TLS_PORT      port the TLS front listens on. Default 4143.
  REMIT_DEV_MAX_RESTARTS  restarts a service may have before it counts as a
                          crash loop. Default 5.
USAGE
}

case "${1-}" in
-h | --help)
	usage
	exit 0
	;;
esac

if ! command -v docker >/dev/null 2>&1; then
	echo "dev-sqlite: docker is not on PATH, so the stack cannot be inspected" >&2
	exit 1
fi

dev_sqlite_compose() {
	docker compose -f "$COMPOSE_FILE" "$@"
}

if ! services="$(dev_sqlite_compose config --services 2>&1)"; then
	echo "dev-sqlite: could not read $COMPOSE_FILE" >&2
	printf '%s\n' "$services" >&2
	exit 1
fi

if ! container_ids="$(dev_sqlite_compose ps --all --quiet 2>&1)"; then
	echo "dev-sqlite: could not list the stack's containers" >&2
	printf '%s\n' "$container_ids" >&2
	exit 1
fi

# No containers at all is not an error to collect facts about — every service is
# then missing, which the services check reports on its own.
facts=""
if [ -n "$container_ids" ]; then
	mapfile -t id_list <<<"$container_ids"
	facts="$(docker inspect --format "$DEV_SQLITE_INSPECT_FORMAT" "${id_list[@]}")"
fi

failures=()
collect() {
	while IFS= read -r failure; do
		[ -n "$failure" ] || continue
		failures+=("$failure")
	done
}

service_failures="$(dev_sqlite_service_failures "$services" "$facts")"
collect <<<"$service_failures"

restart_failures="$(dev_sqlite_restart_failures "$facts" "$MAX_RESTARTS")"
collect <<<"$restart_failures"

service_count="$(printf '%s\n' "$services" | grep -c '[^[:space:]]' || true)"
failed_count="$(printf '%s\n' "$service_failures" | grep -c '[^[:space:]]' || true)"
echo "dev-sqlite: services — $((service_count - failed_count)) of $service_count up"

most_restarted="$(printf '%s\n' "$facts" | awk -F'\t' '
	$1 != "" && $4 + 0 >= count { count = $4 + 0; service = $1 }
	END { if (service == "") print "none"; else print service " at " count }
')"
echo "dev-sqlite: restarts — most restarted: $most_restarted (limit $MAX_RESTARTS)"

tls_status=0
tls_output="$(REMIT_DEV_TLS_PORT="$TLS_PORT" node "$TLS_PROBE" 2>&1)" || tls_status=$?
if [ "$tls_status" -eq 0 ]; then
	echo "dev-sqlite: tls — $tls_output"
else
	failures+=("$tls_output")
fi

# The commit the checkout is on, not the working tree's mtimes: an edit in the
# tree is served, an already-loaded module graph is not.
head_epoch="$(git -C "$REPO_ROOT" log -1 --format=%ct 2>/dev/null || true)"
if [ -n "$head_epoch" ]; then
	stale_list="$(dev_sqlite_stale_services "$facts" "$head_epoch")"
	if [ -n "$stale_list" ]; then
		echo "dev-sqlite: warning — started before the current commit, so anything" \
			"they loaded at start is older code: $stale_list" \
			"(npm run dev:sqlite restarts them)"
	fi
fi

if [ ${#failures[@]} -gt 0 ]; then
	echo "dev-sqlite: unhealthy" >&2
	for failure in "${failures[@]}"; do
		echo "  $failure" >&2
	done
	exit 1
fi

echo "dev-sqlite: healthy"
