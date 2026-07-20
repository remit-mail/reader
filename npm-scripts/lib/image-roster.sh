#!/usr/bin/env bash
# The image roster, derived from the build contexts present in this tree — the
# top-level apisix/ config and every docker/runtime/<service>. The open-core
# export strips the Postgres-only pg-index-worker's runtime context, so it
# drops out automatically and the roster matches the reader's compose without
# editing this file. Shared by images-publish.sh and the release preflight so
# the two never drift.
#
# Run from the repo root; prints one target per line.
image_roster() {
	[ -d apisix ] && echo apisix
	for dir in docker/runtime/*/; do
		basename "$dir"
	done
}
