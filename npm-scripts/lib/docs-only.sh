#!/usr/bin/env bash
# Answers whether a commit range touches prose and nothing else, for the CI job
# that decides which suites a pull request can be spared.
#
# The allow-list is the whole safety argument. Every path in the range has to be
# on it, so a list that grows generous quietly drops the tests off changes that
# needed them; a path nobody thought about reads as code and everything runs.
#
# Renames are switched off on purpose. Rename detection reports one path, so a
# code file renamed to a doc would present as a doc alone, and the file that
# left the build would never be seen. Off, it arrives as the delete and the add
# it is. `core.quotePath` off for the same reason: an escaped non-ASCII path
# matches nothing on the list and would read as code.
#
# Prints `true` or `false`. An empty range prints `false` — there is nothing to
# be spared on behalf of.
set -euo pipefail

is_docs_path() {
	case "$1" in
	*.md | docs/*) return 0 ;;
	LICENSE | NOTICE) return 0 ;;
	*) return 1 ;;
	esac
}

if [ "$#" -ne 2 ]; then
	echo "usage: docs-only.sh <base-ref> <head-ref>" >&2
	exit 2
fi

changed=$(git -c core.quotePath=false diff --no-renames --name-only "$1...$2")

if [ -z "$changed" ]; then
	echo false
	exit 0
fi

while IFS= read -r path; do
	if ! is_docs_path "$path"; then
		echo false
		exit 0
	fi
done <<<"$changed"

echo true
