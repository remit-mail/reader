#!/usr/bin/env bash
# The image roster, derived from the build contexts present in this tree — the
# top-level apisix/ config and every docker/runtime/<service>. The open-core
# export strips the Postgres-only pg-index-worker's runtime context, so it
# drops out automatically and the roster matches the reader's compose without
# editing this file. Shared by images-publish.sh and the release preflight so
# the two never drift.
#
# Populates ALL_TARGETS directly in the caller's shell — call it as a plain
# statement, never through `$(...)` or `<(...)`. A subshell can fail (or, worse,
# silently truncate) without the caller ever seeing a non-zero exit; a direct
# call can't. Run from the repo root.
image_roster() {
	ALL_TARGETS=()
	[ -d apisix ] && ALL_TARGETS+=(apisix)
	for dir in docker/runtime/*/; do
		ALL_TARGETS+=("$(basename "$dir")")
	done
}

# Aborts if the roster came back empty. A wrong-but-nonzero count has nothing
# independent to check it against, but empty is always wrong — every roster
# gained so far has had at least apisix and one node service.
assert_roster_nonempty() {
	if [ "${#ALL_TARGETS[@]}" -eq 0 ]; then
		echo "release: image roster is empty; refusing to proceed" >&2
		exit 1
	fi
}
