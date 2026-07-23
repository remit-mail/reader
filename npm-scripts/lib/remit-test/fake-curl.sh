#!/bin/sh
# A curl stand-in for the `remit` wrapper's suite: serves whatever
# $FAKE_DOCKER_DIR/manifest holds, or fails the way an unreachable host does.
# The wrapper must treat that failure as a failed check and offer nothing — the
# registry is never consulted as a fallback.
set -eu

if [ ! -f "$FAKE_DOCKER_DIR/manifest" ]; then
	printf 'curl: (6) Could not resolve host\n' >&2
	exit 6
fi
cat "$FAKE_DOCKER_DIR/manifest"
