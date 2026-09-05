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
TLS_CHECK="${REMIT_DEV_TLS_CHECK:-1}"
TLS_PORT="${REMIT_DEV_TLS_PORT:-4143}"
MAX_RESTARTS="${REMIT_DEV_MAX_RESTARTS:-5}"
RESTART_WINDOW="${REMIT_DEV_RESTART_WINDOW_SECONDS:-600}"

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
  REMIT_DEV_TLS_CHECK     set to 0 to skip the TLS check. The front-end on 4143
                          has no source in this repository (#1124), so a stack
                          running without one can opt out — the check is then
                          reported as skipped, never quietly dropped.
  REMIT_DEV_MAX_RESTARTS  restarts a service may have before it is rated as a
                          crash loop. Default 5.
  REMIT_DEV_RESTART_WINDOW_SECONDS
                          how recently a service over that count must have
                          restarted to count as looping now. Default 600.
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

# Every docker read below keeps its stderr out of its stdout, and shows it only
# when the command failed. Folded in with 2>&1, a warning docker prints on a
# perfectly successful run — an orphan-containers notice is the common one —
# becomes a phantom service name or a phantom container id, and the id is then
# passed to `docker inspect`, which fails and takes the whole script down with a
# raw docker error instead of a named check.
mkdir -p "$REPO_ROOT/.tmp"
DOCKER_STDERR="$(mktemp "$REPO_ROOT/.tmp/dev-sqlite-health.XXXXXX")"
trap 'rm -f "$DOCKER_STDERR"' EXIT

fail_on_docker() {
	echo "dev-sqlite: $1" >&2
	cat "$DOCKER_STDERR" >&2
	exit 1
}

if ! services="$(dev_sqlite_compose config --services 2>"$DOCKER_STDERR")"; then
	fail_on_docker "could not read $COMPOSE_FILE"
fi

if ! container_ids="$(dev_sqlite_compose ps --all --quiet 2>"$DOCKER_STDERR")"; then
	fail_on_docker "could not list the stack's containers"
fi

# No containers at all is not an error to collect facts about — every service is
# then missing, which the services check reports on its own.
facts=""
if [ -n "$container_ids" ]; then
	mapfile -t id_list <<<"$container_ids"
	if ! facts="$(docker inspect --format "$DEV_SQLITE_INSPECT_FORMAT" \
		"${id_list[@]}" 2>"$DOCKER_STDERR")"; then
		fail_on_docker "could not inspect the stack's containers"
	fi
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

restart_failures="$(dev_sqlite_restart_failures "$facts" "$MAX_RESTARTS" \
	"$RESTART_WINDOW" "$(date +%s)")"
collect <<<"$restart_failures"

service_count="$(printf '%s\n' "$services" | grep -c '[^[:space:]]' || true)"
failed_count="$(printf '%s\n' "$service_failures" | grep -c '[^[:space:]]' || true)"
echo "dev-sqlite: services — $((service_count - failed_count)) of $service_count up"

most_restarted="$(printf '%s\n' "$facts" | awk -F'\t' '
	$1 != "" && $4 + 0 >= count { count = $4 + 0; service = $1 }
	END { if (service == "") print "none"; else print service " at " count }
')"
echo "dev-sqlite: restarts — most restarted: $most_restarted (limit $MAX_RESTARTS)"

# The front-end on 4143 is part of a healthy stack — its absence was one of the
# silent failures — so the check is on by default and an operator who has no
# front-end turns it off by name. Skipping it prints a line of its own rather
# than none: a check that quietly stops running is the shape of the problem this
# command exists to end.
tls_skipped=0
if [ "$TLS_CHECK" = "0" ]; then
	tls_skipped=1
	echo "dev-sqlite: tls — SKIPPED because REMIT_DEV_TLS_CHECK=0;" \
		"nothing here checked that port $TLS_PORT answers"
else
	tls_status=0
	tls_output="$(REMIT_DEV_TLS_PORT="$TLS_PORT" node "$TLS_PROBE" 2>&1)" || tls_status=$?
	if [ "$tls_status" -eq 0 ]; then
		echo "dev-sqlite: tls — $tls_output"
	else
		failures+=("$tls_output")
	fi
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

if [ "$tls_skipped" -eq 1 ]; then
	echo "dev-sqlite: healthy, apart from the TLS front nobody checked"
	exit 0
fi

echo "dev-sqlite: healthy"
