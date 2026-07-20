#!/usr/bin/env bash
# Validates a release summary — the tag annotation shown verbatim on the
# update consent screen (packages/data-ports/src/update-manifest.ts,
# `summary`). release-tag.sh's validation is testable without touching git;
# the one file read below is the exception.
#
# SUMMARY_MAX_LENGTH is read from the schema's own exported constant rather
# than hand-copied, so the two cannot drift: change one and this reads the
# new value on its next invocation.
UPDATE_MANIFEST_TS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/packages/data-ports/src/update-manifest.ts"
SUMMARY_MAX_LENGTH="$(sed -n 's/^export const SUMMARY_MAX_LENGTH = \([0-9]\+\);$/\1/p' "$UPDATE_MANIFEST_TS")"
if [ -z "$SUMMARY_MAX_LENGTH" ]; then
	echo "summary-check: could not read SUMMARY_MAX_LENGTH from ${UPDATE_MANIFEST_TS}" >&2
	exit 1
fi

# Echoes "" for a valid summary, or a one-line reason it was rejected.
validate_summary() {
	local summary="$1"

	if [[ "$summary" == *$'\n'* ]]; then
		echo "summary must be one line"
		return
	fi

	if [ "${#summary}" -eq 0 ]; then
		echo "summary must not be empty"
		return
	fi

	if [ "${#summary}" -gt "$SUMMARY_MAX_LENGTH" ]; then
		echo "summary must be at most ${SUMMARY_MAX_LENGTH} characters (got ${#summary})"
		return
	fi

	echo ""
}
