#!/usr/bin/env bash
# Refuse a release when any image in the roster already exists at the tag
# being released. A release tag is never re-pushed — a botched release is
# fixed by cutting the next one (npm run release:tag), never by overwriting
# this one.
#
# Environment:
#   TAG       tag to check (e.g. v1.4.1). Required.
#   REGISTRY  registry/namespace prefix. Default ghcr.io/remit-mail/reader.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=./lib/image-roster.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/image-roster.sh"

REGISTRY="${REGISTRY:-ghcr.io/remit-mail/reader}"
TAG="${TAG:?TAG is required (e.g. v1.4.1)}"

existing=()
while IFS= read -r target; do
	ref="${REGISTRY}/${target}:${TAG}"
	echo "release: checking ${ref}"
	if docker manifest inspect "$ref" >/dev/null 2>&1; then
		existing+=("$ref")
	fi
done < <(image_roster)

if [ "${#existing[@]}" -gt 0 ]; then
	echo "release: ${TAG} already exists for:" >&2
	printf '  %s\n' "${existing[@]}" >&2
	echo "release: a release tag is never re-pushed; cut the next one instead" >&2
	exit 1
fi

echo "release: ${TAG} is unclaimed across the roster"
