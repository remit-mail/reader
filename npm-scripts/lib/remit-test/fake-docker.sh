#!/bin/sh
# A docker CLI stand-in for the `remit` wrapper's suite (deploy/vps/remit).
#
# The self-update sequence is an ordering problem — snapshot before the stop,
# tag before the stop, no updater recreate before the verdict — so what it has
# to be tested against is a docker that records order and can be told to fail at
# a chosen point. Every invocation is appended to $FAKE_DOCKER_DIR/log and every
# helper-container script to volume-scripts, which is what the assertions read.
#
# $FAKE_DOCKER_DIR/scenario is key=value lines:
#
#   pull=ok|fail              the compose pull
#   snapshot=ok|fail          the VACUUM INTO helper container
#   restore=ok|fail           the restore helper container
#   migrate_exit=N            this run's migrate exit code
#   migrate_exit2=N           the same after a restore, for the rollback's gate
#   migrate_recreate=yes|no   whether `up -d` gives migrate a new container id
#   health=healthy|unhealthy  what the gate's healthchecks report
#   health2=...               the same after a restore
#   probe=ok|fail             GET /health
#   probe2=ok|fail            the same after a restore
#   restarts=N                RestartCount from the second inspect onwards
#   services=...              services with a container, space separated
#   all_services=...          what `compose config --services` lists
#   current_schema=N          what the schema read returns (non-real mode)
#   target_schema=N           the running schema after this run's migrate applies
#   target_schema2=N          the same after a restore (rollback re-runs migrate)
#
# With FAKE_REAL_DB=1 the snapshot, restore and schema read run for real against
# $FAKE_SQLITE_DIR/remit.db (a host directory standing in for the sqlite volume)
# and `compose up ... migrate` applies the run's migration to it, so a
# migration-update test asserts a real byte-restore and a real schema-version
# transition. sqlite3/su-exec/apk/chown must be fakes on PATH.
set -eu

S="$FAKE_DOCKER_DIR"
mkdir -p "$S"

log() { printf '%s\n' "$*" >>"$S/log"; }

val() {
	_v=$(awk -v k="$1" '
		index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }
	' "$S/scenario" 2>/dev/null || true)
	if [ -z "$_v" ]; then _v=$2; fi
	printf '%s' "$_v"
}

# After a restore the stack is on the previous tag, and the rollback's own gate
# is allowed a different verdict from the one that failed.
pick() {
	if [ -f "$S/restored" ]; then
		_alt=$(val "${1}2" "")
		if [ -n "$_alt" ]; then
			printf '%s' "$_alt"
			return 0
		fi
	fi
	val "$1" "$2"
}

# --- real-database mode -----------------------------------------------------
#
# A helper container's script is run for real, its container paths rewritten to
# the host paths the -v mounts named, so the snapshot VACUUMs and the restore
# copies bytes back against a real database. FR_SQLITE/FR_STATE/FR_SNAPLIB are
# set by run_cmd from the -v arguments before this is called.
exec_real() {
	printf '%s' "$1" | sed \
		-e "s#/data/sqlite#$FR_SQLITE#g" \
		-e "s#/snapshot-db.sh#$FR_SNAPLIB#g" \
		-e "s#/state#$FR_STATE#g" |
		sh
}

schema_total() {
	_st=0
	for _t in __drizzle_migrations_entities __drizzle_migrations_auth __drizzle_migrations_meta; do
		_c=$(sqlite3 "$1" "SELECT count(*) FROM $_t" 2>/dev/null || printf 0)
		[ -n "$_c" ] || _c=0
		_st=$((_st + _c))
	done
	printf '%s' "$_st"
}

# The migrate one-shot, modelled: a passing migrate applies this run's schema
# migration to the real database — a new column and a new bookkeeping row that
# lifts the running schema total by one — but only while it is below the target,
# so the forward-only migrate is idempotent and the rollback's re-run (target
# back at the old version via `pick`) changes nothing.
apply_migrate() {
	[ -n "${FAKE_SQLITE_DIR:-}" ] || return 0
	_db="$FAKE_SQLITE_DIR/remit.db"
	[ -f "$_db" ] || return 0
	[ "$(pick migrate_exit 0)" = "0" ] || return 0
	_target=$(pick target_schema 0)
	_cur=$(schema_total "$_db")
	[ "$_cur" -lt "$_target" ] || return 0
	sqlite3 "$_db" "ALTER TABLE message ADD COLUMN filter_move text" 2>/dev/null || true
	sqlite3 "$_db" "INSERT INTO __drizzle_migrations_entities (id, hash, created_at) VALUES ($_cur, 'applied', $_cur)" 2>/dev/null || true
}

next_id() {
	_n=$(cat "$S/seq" 2>/dev/null || printf 0)
	_n=$((_n + 1))
	printf '%s' "$_n" >"$S/seq"
	printf 'c%s%s' "$1" "$_n"
}

recreate() {
	if [ "$1" = "migrate" ] && [ "$(pick migrate_recreate yes)" = "no" ] &&
		[ -f "$S/cid-migrate" ]; then
		return 0
	fi
	_id=$(next_id "$1")
	printf '%s' "$_id" >"$S/cid-$1"
	printf '%s' "$1" >"$S/svc-$_id"
}

svc_of() { cat "$S/svc-$1" 2>/dev/null || printf unknown; }

# Services that exist only while a profile is active. An unscoped `stop`, `down`
# or `config` walks straight past them; `ps` does not, which is the asymmetry the
# wrapper has to be written against.
profile_services() { val profile_services ""; }

# Volumes the project declares. The ones a profile-only service mounts are
# invisible to an unscoped `config --volumes`, so a purge confirmation derived
# from that list understates what it destroys.
volume_names() {
	for _v in $(val volumes "sqlite_data message_storage queue_data caddy_data caddy_config updater_state updater_control"); do
		printf '%s\n' "$_v"
	done
	if [ "$_all_profiles" = "1" ]; then
		for _v in $(val profile_volumes ""); do printf '%s\n' "$_v"; done
	fi
}

is_profile_service() {
	for _p in $(profile_services); do
		[ "$_p" = "$1" ] && return 0
	done
	return 1
}

compose_cmd() {
	_all_profiles=0
	while [ $# -gt 0 ]; do
		case "$1" in
		--profile)
			[ "$2" = "*" ] && _all_profiles=1
			shift 2
			;;
		--project-directory | -f | --env-file) shift 2 ;;
		-*) shift ;;
		*) break ;;
		esac
	done
	_sub=$1
	shift
	if [ "$_all_profiles" = "1" ]; then
		log "compose --profile=* $_sub $*"
	else
		log "compose $_sub $*"
	fi

	case "$_sub" in
	pull)
		if [ "$(val pull ok)" != "ok" ]; then
			printf 'denied: requested access to the resource is denied\n' >&2
			exit 1
		fi
		exit 0
		;;
	stop)
		# The suite's hook for killing the wrapper mid-run: hang where a real
		# stop would take its time.
		if [ -f "$S/hang-stop" ]; then sleep 30; fi
		_named=""
		for _a in "$@"; do
			case "$_a" in
			-*) ;;
			*) _named="$_named $_a" ;;
			esac
		done
		if [ -n "$_named" ]; then
			for _s in $_named; do rm -f "$S/up-$_s"; done
			exit 0
		fi
		# An unscoped stop skips services behind an inactive profile, which is
		# what leaves the backup sidecar running and racing the restore.
		for _s in $(val services "queue backend caddy web apisix"); do
			if [ "$_s" = "backup" ]; then continue; fi
			if [ "$_all_profiles" = "0" ] && is_profile_service "$_s"; then continue; fi
			rm -f "$S/up-$_s"
		done
		rm -f "$S/up-migrate" "$S/up-volume-init" "$S/up-updater"
		exit 0
		;;
	down)
		for _s in $(val services "queue backend caddy web apisix") migrate volume-init updater; do
			if [ "$_all_profiles" = "0" ] && is_profile_service "$_s"; then continue; fi
			rm -f "$S/up-$_s" "$S/cid-$_s"
		done
		# -v takes the volumes with it, and only the ones compose can see.
		case " $* " in
		*" -v "* | *" --volumes "*)
			for _v in $(volume_names); do
				printf '%s\n' "$_v" >>"$S/volumes-removed"
			done
			;;
		esac
		exit 0
		;;
	up)
		_svcs=""
		for _a in "$@"; do
			case "$_a" in
			-*) ;;
			*) _svcs="$_svcs $_a" ;;
			esac
		done
		# An unscoped `up` with no service names skips a service behind an
		# inactive profile — the same asymmetry `stop`, `down` and `config` have.
		# Naming one on the command line enables its profile, so an explicit list
		# starts what it names whatever the profile state.
		if [ -z "$_svcs" ]; then
			for _s in $(val services "queue backend caddy web apisix"); do
				if [ "$_all_profiles" = "0" ] && is_profile_service "$_s"; then continue; fi
				_svcs="$_svcs $_s"
			done
		fi
		for _s in $_svcs; do
			recreate "$_s"
			: >"$S/up-$_s"
		done
		if [ "${FAKE_REAL_DB:-0}" = "1" ]; then
			case " $_svcs " in
			*" migrate "*) apply_migrate ;;
			esac
		fi
		# migrate and volume-init are one-shots: they exit, they do not stay up.
		rm -f "$S/up-migrate" "$S/up-volume-init"
		exit 0
		;;
	config)
		case " $* " in
		*" --services "*)
			# Never the profile services: compose omits them from an unscoped
			# config, which is what makes `config --services` the wrong list to
			# derive "everything" from.
			for _s in $(val all_services "queue migrate volume-init backend apisix web caddy imap-worker smtp-worker account-worker search-index-worker"); do
				printf '%s\n' "$_s"
			done
			;;
		*" --volumes "*)
			volume_names
			;;
		esac
		exit 0
		;;
	ps)
		case " $* " in
		*" --services "*)
			# `ps` reports a profile container whether or not the profile is
			# named — unlike `stop`, `down` and `config`. That asymmetry is why
			# `remit update` already survived profiles and `remit purge` did not.
			for _s in $(val services "queue backend caddy web apisix"); do
				if [ -f "$S/up-$_s" ]; then printf '%s\n' "$_s"; fi
			done
			exit 0
			;;
		esac
		_all=0
		_svc=""
		for _a in "$@"; do
			case "$_a" in
			-aq | -qa) _all=1 ;;
			-a) _all=1 ;;
			-*) ;;
			*) _svc=$_a ;;
			esac
		done
		if [ -n "$_svc" ]; then
			if [ ! -f "$S/cid-$_svc" ]; then exit 0; fi
			if [ "$_all" = "0" ] && [ ! -f "$S/up-$_svc" ]; then exit 0; fi
			cat "$S/cid-$_svc"
			printf '\n'
			exit 0
		fi
		for _s in $(val services "queue backend caddy web apisix"); do
			if [ -f "$S/cid-$_s" ] && { [ "$_all" = "1" ] || [ -f "$S/up-$_s" ]; }; then
				cat "$S/cid-$_s"
				printf '\n'
			fi
		done
		exit 0
		;;
	*) exit 0 ;;
	esac
}

inspect_cmd() {
	_fmt=""
	_cid=""
	while [ $# -gt 0 ]; do
		case "$1" in
		-f | --format)
			_fmt=$2
			shift 2
			;;
		-*) shift ;;
		*)
			_cid=$1
			shift
			;;
		esac
	done
	_svc=$(svc_of "$_cid")
	case "$_fmt" in
	*RestartCount*)
		# Zero on the first read per service, so the gate's baseline is taken
		# before any simulated crash loop shows up.
		_seen="$S/rc-$_svc"
		if [ -f "$_seen" ]; then
			pick restarts 0
		else
			: >"$_seen"
			printf 0
		fi
		;;
	*ExitCode*) pick migrate_exit 0 ;;
	*Health*)
		if [ -f "$S/up-$_svc" ]; then pick health healthy; else printf 'unhealthy'; fi
		;;
	*State.Running*)
		if [ -f "$S/up-$_svc" ]; then printf 'true'; else printf 'false'; fi
		;;
	*State.Status*)
		if [ "$_svc" = "migrate" ]; then
			printf 'exited'
		elif [ -f "$S/up-$_svc" ]; then
			printf 'running'
		else
			printf 'exited'
		fi
		;;
	*) printf '' ;;
	esac
	printf '\n'
	exit 0
}

run_cmd() {
	_script=""
	_probe=0
	_detached=0
	_entry=""
	_statesrc=""
	_bindsrc=""
	FR_SQLITE=""
	FR_STATE=""
	FR_SNAPLIB=""
	# The helper container's script is the last argument after -c; the -v
	# arguments name the host paths real-database mode rewrites container paths to.
	_prev=""
	for _a in "$@"; do
		case "$_a" in
		container:*) _probe=1 ;;
		-d) _detached=1 ;;
		esac
		if [ "$_prev" = "--entrypoint" ]; then _entry=$_a; fi
		if [ "$_prev" = "-v" ]; then
			_bindsrc=${_a%%:*}
			_cpath=${_a#*:}
			_cpath=${_cpath%:ro}
			case "$_cpath" in
			/data/sqlite) FR_SQLITE=${_a%%:*} ;;
			/state) FR_STATE=${_a%%:*} ;;
			/snapshot-db.sh) FR_SNAPLIB=${_a%%:*} ;;
			esac
			case "$_cpath" in
			/state) _statesrc=${_a%%:*} ;;
			esac
		fi
		if [ "$_prev" = "-c" ]; then _script=$_a; fi
		_prev=$_a
	done
	if [ "$_probe" = "1" ]; then
		log "run probe entrypoint=$_entry"
		_pv=$(pick probe ok)
		# hang models the reader#284 ghost: a probe container that never returns.
		# The wrapper's timeout is what has to end it, so the fake just blocks (with
		# its fds detached, so nothing waiting on this run's output blocks with it).
		if [ "$_pv" = "hang" ]; then
			sleep "${FAKE_PROBE_HANG:-8}" >/dev/null 2>&1
			exit 1
		fi
		if [ "$_pv" = "ok" ]; then exit 0; fi
		exit 1
	fi
	# The detached one-shot that recreates the updater (reader#291): it drives
	# compose rather than a volume, so it is matched by its script, not a mount.
	case "$_script" in
	*"up -d updater"*)
		log "run updater-recreate detached=$_detached entrypoint=$_entry statesrc=$_statesrc"
		exit 0
		;;
	esac
	# The bind-identity probe (reader#272): the wrapper writes a marker into the
	# deployment directory and reads it back through the daemon at the same path.
	# `src=` records the bind source it handed the daemon so a test can assert it
	# is absolute. mount_identity=broken models a mount that is not the host path —
	# the helper sees a different directory, so the marker never comes back.
	case "$_script" in
	*remit-mount-identity*)
		log "run identity src=$_bindsrc"
		[ "$(pick mount_identity ok)" = "broken" ] && exit 0
		eval "$_script"
		exit 0
		;;
	esac
	{
		printf -- '--- volume script ---\n'
		printf '%s\n' "$_script"
	} >>"$S/volume-scripts"
	case "$_script" in
	*__drizzle_migrations*)
		log "run schema-read"
		if [ "${FAKE_REAL_DB:-0}" = "1" ]; then
			exec_real "$_script"
			exit $?
		fi
		printf '%s' "$(pick current_schema "")"
		exit 0
		;;
	*snapshot_db*)
		log "run snapshot"
		if [ "$(val snapshot ok)" != "ok" ]; then exit 1; fi
		if [ "${FAKE_REAL_DB:-0}" = "1" ]; then exec_real "$_script" || exit 1; fi
		exit 0
		;;
	*)
		log "run restore"
		if [ "$(val restore ok)" != "ok" ]; then exit 1; fi
		if [ "${FAKE_REAL_DB:-0}" = "1" ]; then exec_real "$_script" || exit 1; fi
		: >"$S/restored"
		exit 0
		;;
	esac
}

case "${1:-}" in
compose)
	shift
	compose_cmd "$@"
	;;
inspect)
	shift
	inspect_cmd "$@"
	;;
run)
	shift
	run_cmd "$@"
	;;
*)
	log "docker $*"
	exit 0
	;;
esac
