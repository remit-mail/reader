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

# Boot recovery. This is what restart:unless-stopped buys: a container killed
# mid-update — or the whole host rebooted — comes back and reaches a terminal
# verdict without an operator. No interrupted run is a no-op.
remit update --recover || true

# Watch for the backend's request. `remit update` validates it, consumes it, and
# either installs the release or records the rejection in state.json; a rejected
# or failed request must not crash the watcher, so its status is not fatal.
_request="$REMIT_UPDATE_CONTROL_DIR/request.json"
while :; do
	if [ -f "$_request" ]; then
		remit update || true
	fi
	sleep "$WATCH_INTERVAL"
done
