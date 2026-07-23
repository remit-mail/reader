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

compose_cmd() {
	while [ $# -gt 0 ]; do
		case "$1" in
		--project-directory | -f | --env-file | --profile) shift 2 ;;
		-*) shift ;;
		*) break ;;
		esac
	done
	_sub=$1
	shift
	log "compose $_sub $*"

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
			if [ "$_s" != "backup" ]; then rm -f "$S/up-$_s"; fi
		done
		rm -f "$S/up-migrate" "$S/up-volume-init" "$S/up-updater"
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
		if [ -z "$_svcs" ]; then _svcs=$(val services "queue backend caddy web apisix"); fi
		for _s in $_svcs; do
			recreate "$_s"
			: >"$S/up-$_s"
		done
		# migrate and volume-init are one-shots: they exit, they do not stay up.
		rm -f "$S/up-migrate" "$S/up-volume-init"
		exit 0
		;;
	config)
		case " $* " in
		*" --services "*)
			for _s in $(val all_services "queue migrate volume-init backend apisix web caddy imap-worker smtp-worker account-worker search-index-worker"); do
				printf '%s\n' "$_s"
			done
			;;
		esac
		exit 0
		;;
	ps)
		case " $* " in
		*" --services "*)
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
	for _a in "$@"; do
		case "$_a" in
		container:*) _probe=1 ;;
		esac
	done
	if [ "$_probe" = "1" ]; then
		log "run probe"
		if [ "$(pick probe ok)" = "ok" ]; then exit 0; fi
		exit 1
	fi
	# The helper container's script is the last argument after -c.
	_prev=""
	for _a in "$@"; do
		if [ "$_prev" = "-c" ]; then _script=$_a; fi
		_prev=$_a
	done
	{
		printf -- '--- volume script ---\n'
		printf '%s\n' "$_script"
	} >>"$S/volume-scripts"
	case "$_script" in
	*snapshot_db*)
		log "run snapshot"
		if [ "$(val snapshot ok)" != "ok" ]; then exit 1; fi
		exit 0
		;;
	*)
		log "run restore"
		if [ "$(val restore ok)" != "ok" ]; then exit 1; fi
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
