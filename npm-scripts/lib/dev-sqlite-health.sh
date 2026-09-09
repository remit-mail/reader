#!/usr/bin/env bash
# The verdicts behind `npm run dev:sqlite:health`. Sourced, never run.
#
# Split out from the entrypoint because the entrypoint is all I/O — docker
# inspect, a TLS connect — and the part worth pinning is what the facts mean.
# Every function here takes the collected facts as text and echoes one line per
# failure, empty when the check passes, so the caller can name which check
# failed rather than reporting "the stack is broken".
#
# The fact table is one tab-separated line per container of the compose project,
# in DEV_SQLITE_INSPECT_FORMAT's field order:
#
#   service  status  exit-code  restart-count  health  restart-policy  started-at
#
# `health` is "none" for a service that declares no healthcheck.
#
# `restart-policy` is what tells the migrator apart from a service that is meant
# to stay up: the compose file gives every long-running service
# `restart: unless-stopped` and the migrator `restart: "no"`. A service added
# without a restart policy therefore reads as a one-shot and is reported as one
# that never completed — a named failure to correct, not a silent pass.
# shellcheck disable=SC2034  # read by the entrypoint that sources this file
DEV_SQLITE_INSPECT_FORMAT='{{index .Config.Labels "com.docker.compose.service"}}	{{.State.Status}}	{{.State.ExitCode}}	{{.RestartCount}}	{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}	{{.HostConfig.RestartPolicy.Name}}	{{.State.StartedAt}}'

dev_sqlite_fact() {
	printf '%s\n' "$2" | awk -F'\t' -v want="$1" '$1 == want { print; exit }'
}

# Claim 1: every service the compose file declares is up.
#
# "Up" is three different things across this stack. The migrator is a one-shot
# that compose orders every app service behind, so for it "up" means it ran to
# completion. The services carrying a healthcheck — backend and web — are only
# up when that healthcheck passes, which is the difference between vite holding
# port 4123 and vite serving on it. The queue drainers answer no URL at all, so
# for them "running" is the whole of it.
dev_sqlite_service_failures() {
	local services="$1" facts="$2"
	local service line status code health policy

	while IFS= read -r service; do
		[ -n "$service" ] || continue

		line="$(dev_sqlite_fact "$service" "$facts")"
		if [ -z "$line" ]; then
			echo "services: $service has no container"
			continue
		fi

		IFS=$'\t' read -r _ status code _ health policy _ <<<"$line"

		if [ "$policy" = "no" ]; then
			if [ "$status" != "exited" ] || [ "$code" != "0" ]; then
				echo "services: $service is a one-shot that has not completed — $status, exit code $code"
			fi
			continue
		fi

		if [ "$status" != "running" ]; then
			echo "services: $service is $status, exit code $code"
			continue
		fi

		# "starting" is a service inside its healthcheck's start_period, which is 90
		# seconds for the backend and 120 for the web client. It is not serving yet,
		# so it is not up — but it is on its way there rather than broken, and the
		# line has to read that way or every check run during a boot looks like a
		# fault.
		if [ "$health" = "starting" ]; then
			echo "services: $service is still starting, its healthcheck has not passed yet"
			continue
		fi

		if [ "$health" != "none" ] && [ "$health" != "healthy" ]; then
			echo "services: $service is running but $health"
		fi
	done <<<"$services"
}

# Claim 2: nothing is crash-looping right now.
#
# A restarting service reads as "up" to `docker compose ps` and to anything that
# only asks whether a container exists — the search-index-worker was on its
# ~6400th restart, and every surface still called the stack fine.
#
# `.RestartCount` alone cannot answer it, because the count is cumulative for the
# life of the container: six restarts last week would fail this check every day
# until somebody recreated the container, and a check that stays red is a check
# people stop reading. So the count is rated against how long the service has
# been up since its last restart. Docker's restart backoff tops out at a minute,
# so anything genuinely looping restarted within the window; a service that has
# held for longer than the window is not looping now, whatever it did before.
dev_sqlite_restart_failures() {
	local facts="$1" limit="$2" window="$3" now="$4"
	local service restarts started started_epoch uptime

	while IFS=$'\t' read -r service _ _ restarts _ _ started; do
		[ -n "$service" ] || continue
		case "$restarts" in
		'' | *[!0-9]*) continue ;;
		esac
		[ "$restarts" -gt "$limit" ] || continue

		started_epoch="$(date -d "$started" +%s 2>/dev/null || echo "")"
		if [ -z "$started_epoch" ]; then
			echo "restarts: $service has restarted $restarts times, over the limit of $limit, and its start time could not be read"
			continue
		fi

		uptime=$((now - started_epoch))
		[ "$uptime" -lt "$window" ] || continue
		echo "restarts: $service has restarted $restarts times and has been up for only ${uptime}s — it is crash-looping"
	done <<<"$facts"
}

# The staleness signal, reported as a warning rather than a failure.
#
# The app services bind-mount the worktree and run it through tsx, which loads
# the module graph once and never reloads it, so a container that started before
# the current commit is serving code from whenever it started — that is how
# backend and imap-worker ran 106 commits behind. It stays a warning because a
# commit made during a dev session puts the stack here legitimately; the answer
# is `npm run dev:sqlite` again, not a red check.
dev_sqlite_stale_services() {
	local facts="$1" since="$2"
	local service status policy started started_epoch stale=()

	while IFS=$'\t' read -r service status _ _ _ policy started; do
		[ -n "$service" ] || continue
		[ "$status" = "running" ] || continue
		[ "$policy" != "no" ] || continue
		started_epoch="$(date -d "$started" +%s 2>/dev/null || echo "")"
		[ -n "$started_epoch" ] || continue
		[ "$started_epoch" -lt "$since" ] || continue
		stale+=("$service")
	done <<<"$facts"

	[ ${#stale[@]} -eq 0 ] || echo "${stale[*]}"
}
