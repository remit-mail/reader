#!/bin/sh
# A curl stand-in for the `remit` wrapper's suite: serves whatever
# $FAKE_DOCKER_DIR/manifest holds, or fails the way an unreachable host does.
# The wrapper must treat that failure as a failed check and offer nothing — the
# registry is never consulted as a fallback.
#
# A release's host-side files (reader#1072) come through the same tool, from a
# URL under the repository's deploy path. Those are served from
# $FAKE_DOCKER_DIR/assets by basename, into the -o destination; a name that is
# not there fails the way a 404 does. Every asset URL asked for is appended to
# $FAKE_DOCKER_DIR/asset-log, so a test can read which release was fetched from.
set -eu

_url=""
_out=""
_prev=""
for _a in "$@"; do
	if [ "$_prev" = "-o" ]; then _out=$_a; fi
	case "$_a" in
	http://* | https://*) _url=$_a ;;
	esac
	_prev=$_a
done

case "$_url" in
*/deploy/vps/*)
	printf '%s\n' "$_url" >>"$FAKE_DOCKER_DIR/asset-log"
	_name=${_url##*/}
	[ -f "$FAKE_DOCKER_DIR/assets/$_name" ] || exit 22
	if [ -n "$_out" ]; then
		cat "$FAKE_DOCKER_DIR/assets/$_name" >"$_out"
	else
		cat "$FAKE_DOCKER_DIR/assets/$_name"
	fi
	exit 0
	;;
esac

if [ ! -f "$FAKE_DOCKER_DIR/manifest" ]; then
	printf 'curl: (6) Could not resolve host\n' >&2
	exit 6
fi
cat "$FAKE_DOCKER_DIR/manifest"
