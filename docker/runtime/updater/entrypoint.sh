#!/bin/sh
#
# Updater entrypoint (RFC 037 D4, #133).
#
# Two things, in order: finish any interrupted update, then watch the control
# seam. It runs the same deploy/vps/remit the host operator runs — one
# implementation of the atomic update, gate and rollback — and listens on no
# port. The volume mount is the entire authentication story.
set -eu

: "${REMIT_DIR:=/deployment}"
: "${REMIT_UPDATE_CONTROL_DIR:=/data/control}"
: "${REMIT_UPDATE_STATE_DIR:=/data/updater}"
: "${REMIT_UPDATER_IMAGE_REPO:=ghcr.io/remit-mail/reader/updater}"
WATCH_INTERVAL="${REMIT_UPDATE_WATCH_INTERVAL:-5}"

# How often the updater checks for a newer release on its own. The default is six
# hours: often enough that a self-hoster learns of a security release the same
# day, rare enough that it is invisible on the manifest host's logs. Override
# REMIT_UPDATE_CHECK_INTERVAL (seconds) to change it; the check never installs
# anything, so a short interval only costs one manifest fetch.
CHECK_INTERVAL="${REMIT_UPDATE_CHECK_INTERVAL:-21600}"

# Floored at five minutes: a fat-fingered small value — or a non-numeric one —
# would otherwise poll the manifest host on every watch tick. The floor is a
# clamp, not a rejection, so a bad value degrades to a sane cadence rather than
# stopping the updater.
case "$CHECK_INTERVAL" in
*[!0-9]* | "") CHECK_INTERVAL=300 ;;
*) if [ "$CHECK_INTERVAL" -lt 300 ]; then CHECK_INTERVAL=300; fi ;;
esac

mkdir -p "$REMIT_UPDATE_CONTROL_DIR" "$REMIT_UPDATE_STATE_DIR"

# The backend runs as uid 1000 and writes request.json onto the control volume,
# which Docker creates root-owned. Hand it to that uid so the backend can write;
# state.json this container writes back is made world-readable per-file (it
# carries no secret), so the backend reads it across the uid boundary.
chown 1000:1000 "$REMIT_UPDATE_CONTROL_DIR" 2>/dev/null || true

# The snapshot, restore and health helpers run as containers off this same
# image, so sqlite3 is present without an apk install. The tag is the one on the
# box: .env still names the running version at snapshot time, and it is pulled.
_tag=$(awk -F= '/^REMIT_TAG=/{print $2; exit}' "$REMIT_DIR/.env" 2>/dev/null || true)
[ -n "$_tag" ] || _tag="${REMIT_TAG:-latest}"
export REMIT_UPDATE_HELPER_IMAGE="${REMIT_UPDATER_IMAGE_REPO}:${_tag}"

# Prove the mount before touching the stack. Socket-driven compose resolves this
# deployment's relative binds against $REMIT_DIR as a host path, so a mount that
# is not the deployment directory's host path would have the daemon corrupt host
# files on the first recreate (reader#272). On a mismatch the wrapper records the
# failure on the control seam for the app to render; idle rather than serve, so
# `restart: unless-stopped` does not spin and a fixed .env takes effect on the
# next recreate. Recovery and the request watch never run against a bad mount.
if ! remit update --preflight; then
	while :; do sleep "$WATCH_INTERVAL"; done
fi

# Boot recovery. This is what restart:unless-stopped buys: a container killed
# mid-update — or the whole host rebooted — comes back and reaches a terminal
# verdict without an operator. No interrupted run is a no-op.
remit update --recover || true

# The first check writes state.json onto the control volume the moment the
# updater starts, so the app has an update status to show instead of a spinner
# that never resolves. Nothing else writes state.json until an update is asked
# for, and the owner cannot ask until a check has offered a version — so without
# this the surface is stuck before it begins. A failed check records itself in
# state.json and is not fatal to the watcher.
remit update --check || true
_last_check=$(date +%s)

# Watch for the backend's request. `remit update` validates it, consumes it, and
# either installs the release or records the rejection in state.json; a rejected
# or failed request must not crash the watcher, so its status is not fatal.
_request="$REMIT_UPDATE_CONTROL_DIR/request.json"
while :; do
	if [ -f "$_request" ]; then
		remit update || true
		# An update runs a check as its first step, so the cadence clock restarts
		# here rather than firing a second check on its heels.
		_last_check=$(date +%s)
	fi
	# The periodic check shares the watch loop so it never adds to request
	# latency: the loop still wakes every WATCH_INTERVAL for request.json, and a
	# check is spent only once CHECK_INTERVAL has elapsed since the last one.
	_now=$(date +%s)
	if [ "$((_now - _last_check))" -ge "$CHECK_INTERVAL" ]; then
		remit update --check || true
		_last_check=$(date +%s)
	fi
	sleep "$WATCH_INTERVAL"
done
