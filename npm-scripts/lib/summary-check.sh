#!/usr/bin/env bash
# Validates a release summary — the tag annotation shown verbatim on the
# update consent screen (packages/data-ports/src/update-manifest.ts,
# `summary`). Pure — no I/O — so release-tag.sh's validation is testable
# without touching git.
#
# SUMMARY_MAX_LENGTH must stay in sync with that schema's `z.string().max(140)`.
SUMMARY_MAX_LENGTH=140

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
