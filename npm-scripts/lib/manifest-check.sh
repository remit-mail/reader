#!/usr/bin/env bash
# Classifies the result of a single registry manifest-existence check. Pure —
# no I/O, no network — so release-check-tag.sh's decision of what to do with
# a check result is testable without a real registry call.
#
# Call with the exit status and combined stdout+stderr of the check command,
# plus the HTTP status of an anonymous pull-token request for the package (empty
# when none was made); echoes exactly one of:
#   exists  — the command succeeded; the tag is published, refuse the release
#   absent  — the registry's own "manifest unknown" for a tag that has never
#             been published in an existing package, or GHCR's "denied" for a
#             package that has never been published at all. The roster is
#             public, so a package that exists grants an anonymous pull token;
#             a 403 there means no such package. A 200 means the package exists
#             and the denial is an auth failure.
#   abort   — anything else. A network error, an auth failure, or a typo'd
#             registry must never be read as "the tag is free" — that
#             misreading is the one this script exists to prevent.
classify_manifest_check() {
	local status="$1"
	local output="$2"
	local anonymous_token_status="${3:-}"

	if [ "$status" -eq 0 ]; then
		echo exists
		return
	fi

	if [[ "$output" == *"manifest unknown"* ]]; then
		echo absent
		return
	fi

	if [[ "$output" == *"denied"* ]] && [ "$anonymous_token_status" = 403 ]; then
		echo absent
		return
	fi

	echo abort
}
