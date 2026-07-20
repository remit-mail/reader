#!/usr/bin/env bash
# Shared by e2e-dev-up.sh / e2e-dev-down.sh / e2e-dev-logs.sh. Sourced, never
# run.
#
# The source-built lane runs the app from the worktree as host processes and
# borrows exactly one container from the image lane: Dovecot. `docker compose`
# is invoked from deploy/vps so that file's relative bind mounts resolve, and
# under its own project name so an image run and a dev run never share
# containers.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy/vps"
DEV_TEMPLATE="$REPO_ROOT/localhost-e2e-dev.env"
DEV_STATE_DIR="$REPO_ROOT/.remit/e2e-dev"
DEV_ENV="$DEV_STATE_DIR/.env"
DEV_LOG_DIR="$DEV_STATE_DIR/logs"
DEV_PID_DIR="$DEV_STATE_DIR/pids"

# A run identifies its lane with E2E_DEV_SLOT. Unset — a developer's machine —
# it is the single lane the committed template describes. Set, every host-wide
# name this stack claims is derived from it: the compose project and the port
# block. Two runs on one host therefore share nothing, and `down` can only reach
# the containers its own slot created.
#
# The slot is stable rather than unique on purpose. CI passes the runner's name,
# which that runner reuses, so a run interrupted before its teardown leaves
# containers the next run on the same runner recreates instead of orphans.
E2E_DEV_SLOT="${E2E_DEV_SLOT-}"
E2E_DEV_PROJECT="remit-e2e-dev"
if [ -n "$E2E_DEV_SLOT" ]; then
	E2E_DEV_PROJECT="remit-e2e-dev-$(printf '%s' "$E2E_DEV_SLOT" |
		tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | cut -c1-40)"
fi

e2e_dev_compose() {
	docker compose \
		--project-name "$E2E_DEV_PROJECT" \
		--project-directory "$DEPLOY_DIR" \
		-f "$DEPLOY_DIR/docker-compose.dovecot.yml" \
		"$@"
}

# The four ports a slot claims, contiguous so one block per slot covers the whole
# stack. 400 blocks is far more than a host runs concurrently; a hash collision
# between two live slots is caught by e2e_dev_require_free_ports, which fails the
# run rather than letting it attach to the other stack.
e2e_dev_slot_ports() {
	[ -n "$E2E_DEV_SLOT" ] || return 0
	local index base
	index=$(($(printf '%s' "$E2E_DEV_SLOT" | cksum | cut -d' ' -f1) % 400))
	base=$((20000 + index * 4))
	: "${E2E_HTTP_PORT:=$base}"
	: "${SERVER_PORT:=$((base + 1))}"
	: "${QUEUE_SIDECAR_PORT:=$((base + 2))}"
	: "${E2E_IMAP_PORT:=$((base + 3))}"
	echo "e2e-dev: slot $E2E_DEV_SLOT — project $E2E_DEV_PROJECT, ports $base-$((base + 3))"
}

# Resolve the committed template into the generated env this run uses, then load
# it. Anything in E2E_DEV_OVERRIDABLE that the caller already set is appended
# afterwards and wins, which is how a second run on one machine moves its ports.
#
# Everything that follows a port or a path is derived here rather than committed,
# so an override cannot leave half the stack pointing at the old value.
e2e_dev_install_env() {
	mkdir -p "$DEV_STATE_DIR"
	cp "$DEV_TEMPLATE" "$DEV_ENV"

	e2e_dev_slot_ports

	for name in E2E_HTTP_PORT E2E_IMAP_PORT SERVER_PORT QUEUE_SIDECAR_PORT; do
		[ -n "${!name-}" ] || continue
		printf '%s=%s\n' "$name" "${!name}" >>"$DEV_ENV"
		echo "e2e-dev: $name overridden to ${!name}"
	done

	# shellcheck disable=SC1090
	set -a && source "$DEV_ENV" && set +a

	# The app reaches Dovecot on the same published port the suite does, so an
	# E2E_IMAP_PORT override has to carry into the stack-side coordinate too.
	{
		printf 'E2E_IMAP_STACK_PORT=%s\n' "$E2E_IMAP_PORT"

		# PUBLIC_ORIGIN has to name the address the browser actually loads, port
		# included, or better-auth rejects the Origin and every UI spec fails on
		# sign-in. The other four are the same origin under the names the backend
		# reads it by.
		origin="http://localhost:$E2E_HTTP_PORT"
		printf 'PUBLIC_ORIGIN=%s\n' "$origin"
		printf 'BETTER_AUTH_URL=%s\n' "$origin"
		printf 'BETTER_AUTH_TRUSTED_ORIGINS=%s\n' "$origin"
		printf 'CORS_ALLOWED_ORIGINS=%s\n' "$origin"
		printf 'CONTENT_DELIVERY_DOMAIN=%s\n' "$origin"
		printf 'BETTER_AUTH_JWKS_URL=http://127.0.0.1:%s/api/auth/jwks\n' "$SERVER_PORT"
		printf 'VITE_PROXY_BACKEND_PORT=%s\n' "$SERVER_PORT"

		# The queue set is deploy/vps/queues.json — the image stack's own — so the
		# names are fixed and only the port moves. Derived rather than committed:
		# a queue URL left pointing at the old port after an override would send
		# the app to somebody else's sidecar instead of failing.
		local queue="http://127.0.0.1:$QUEUE_SIDECAR_PORT/000000000000"
		printf 'SQS_QUEUE_URL_MAILBOXES=%s/remit-mailboxes.fifo\n' "$queue"
		printf 'SQS_QUEUE_URL_MESSAGES=%s/remit-messages.fifo\n' "$queue"
		printf 'SQS_QUEUE_URL_FLAGS=%s/remit-flags.fifo\n' "$queue"
		printf 'SQS_QUEUE_URL_BODY=%s/remit-body\n' "$queue"
		printf 'SQS_QUEUE_URL_MAILBOX_MGMT=%s/remit-mailbox-mgmt\n' "$queue"
		printf 'SQS_QUEUE_URL_MESSAGE_MGMT=%s/remit-message-mgmt\n' "$queue"
		printf 'SQS_QUEUE_URL_SMTP=%s/remit-smtp\n' "$queue"
		printf 'SQS_QUEUE_URL=%s/remit-mailboxes.fifo\n' "$queue"
		printf 'SQS_QUEUE_URL_ACCOUNT_FANOUT=%s/remit-account-fanout\n' "$queue"
		printf 'SQS_QUEUE_URL_ACCOUNT_FINALIZE=%s/remit-account-finalize\n' "$queue"
		printf 'SQS_QUEUE_URL_ACCOUNT_PURGE_DELETE=%s/remit-account-purge-delete.fifo\n' "$queue"

		# Absolute, because each process runs with its own package directory as
		# cwd. The migrator is the exception — its drizzle folders are relative to
		# deploy/vps, which is where e2e-dev-up.sh runs it from.
		printf 'SQLITE_DB_PATH=%s/remit.db\n' "$DEV_STATE_DIR"
		printf 'LOCAL_VECTORDB_PATH=%s/vec.db\n' "$DEV_STATE_DIR"
		printf 'STORAGE_LOCAL_PATH=%s/storage\n' "$DEV_STATE_DIR"
		printf 'QUEUE_SIDECAR_DB=%s/queue.db\n' "$DEV_STATE_DIR"
		printf 'QUEUE_SIDECAR_QUEUES_CONFIG=%s/queues.json\n' "$DEPLOY_DIR"

		# HOME follows the state dir so vite and npm write their caches there and
		# not into a CI runner's home.
		printf 'HOME=%s\n' "$DEV_STATE_DIR"
	} >>"$DEV_ENV"

	# shellcheck disable=SC1090
	set -a && source "$DEV_ENV" && set +a
}

# Start one long-running service from the worktree, detached from this shell,
# with its log and pid under the state dir.
#
# `setsid` gives each service its own process group, and the pid file records
# that group rather than the process. Every service here is an `npm run` that
# forks the real program — and the imap-worker forks again, one child per queue
# — so signalling the recorded pid alone would leave the workers behind.
# Stopping the group stops the tree.
e2e_dev_start() {
	local name="$1"
	shift
	mkdir -p "$DEV_LOG_DIR" "$DEV_PID_DIR"
	setsid "$@" >"$DEV_LOG_DIR/$name.log" 2>&1 &
	echo $! >"$DEV_PID_DIR/$name.pid"
	echo "e2e-dev: started $name (pid $(cat "$DEV_PID_DIR/$name.pid"))"
}

# Stop every service this lane started, group by group. Safe to run when
# nothing is up.
e2e_dev_stop_all() {
	[ -d "$DEV_PID_DIR" ] || return 0
	for pidfile in "$DEV_PID_DIR"/*.pid; do
		[ -e "$pidfile" ] || continue
		local name pid
		name="$(basename "$pidfile" .pid)"
		pid="$(cat "$pidfile")"
		if kill -0 "$pid" 2>/dev/null; then
			kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
			for _ in $(seq 1 20); do
				kill -0 "$pid" 2>/dev/null || break
				sleep 0.5
			done
			kill -KILL -- "-$pid" 2>/dev/null || true
			echo "e2e-dev: stopped $name"
		fi
		rm -f "$pidfile"
	done
}

# Wait for a service to answer, naming it so a timeout says which one never came
# up rather than just "the stack".
#
# The process is checked before the URL, and that order is the point. A port
# answering does not mean THIS stack is answering: the first version of this
# script only polled the URL, and when the sidecar died on EADDRINUSE the poll
# was satisfied by the unrelated process already holding the port. The run went
# green against someone else's queue. Whoever the port belongs to, a service
# that exited is a failed `up`.
e2e_dev_wait_for() {
	local name="$1" url="$2" attempts="${3:-90}"
	local pid
	pid="$(cat "$DEV_PID_DIR/$name.pid" 2>/dev/null || true)"
	for _ in $(seq 1 "$attempts"); do
		if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
			echo "e2e-dev: $name exited before it served $url" >&2
			tail -n 40 "$DEV_LOG_DIR/$name.log" 2>/dev/null || true
			return 1
		fi
		if curl -fsS -o /dev/null "$url" 2>/dev/null; then
			echo "e2e-dev: $name is up at $url"
			return 0
		fi
		sleep 1
	done
	echo "e2e-dev: $name never answered at $url" >&2
	tail -n 40 "$DEV_LOG_DIR/$name.log" 2>/dev/null || true
	return 1
}

# Refuse to start on a port something else already holds. The liveness check
# above would catch it anyway, but only after the stack has half started, and
# the message it gives names the symptom rather than the cause.
e2e_dev_require_free_ports() {
	local occupied=()
	for port in "$@"; do
		if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
			occupied+=("$port")
			exec 3<&- 3>&-
		fi
	done
	[ ${#occupied[@]} -eq 0 ] && return 0
	echo "e2e-dev: ports already in use: ${occupied[*]}" >&2
	echo "e2e-dev: move this run with E2E_HTTP_PORT / E2E_IMAP_PORT / SERVER_PORT / QUEUE_SIDECAR_PORT" >&2
	return 1
}
