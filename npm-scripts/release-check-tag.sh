#!/usr/bin/env bash
# Refuse a release when any image in the roster already exists at the tag
# being released. A release tag is never re-pushed — a botched release is
# fixed by cutting the next one (npm run release:tag), never by overwriting
# this one.
#
# A tag reads as absent only on the registry's own "manifest unknown" — the
# response for a genuinely missing tag. Every other failure (a network error,
# an auth problem, a typo'd REGISTRY) aborts instead of being read as "free",
# because misreading any of those as free is exactly the mistake this script
# exists to prevent: it would let a release build proceed and overwrite a tag
# it never actually checked.
#
# Environment:
#   TAG       tag to check (e.g. v1.4.1). Required.
#   REGISTRY  registry/namespace prefix. Default ghcr.io/remit-mail/reader.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=npm-scripts/lib/container-runtime.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/container-runtime.sh"
# shellcheck source=npm-scripts/lib/image-roster.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/image-roster.sh"

REGISTRY="${REGISTRY:-ghcr.io/remit-mail/reader}"
TAG="${TAG:?TAG is required (e.g. v1.4.1)}"

image_roster
assert_roster_nonempty
echo "release: roster is ${ALL_TARGETS[*]} (${#ALL_TARGETS[@]} targets)"

existing=()
for target in "${ALL_TARGETS[@]}"; do
	ref="${REGISTRY}/${target}:${TAG}"
	echo "release: checking ${ref}"

	output=""
	if output="$("$CR" manifest inspect "$ref" 2>&1)"; then
		existing+=("$ref")
		continue
	fi

	if [[ "$output" == *"manifest unknown"* ]]; then
		continue
	fi

	echo "release: could not determine whether ${ref} exists; refusing to guess" >&2
	echo "$output" >&2
	exit 1
done

if [ "${#existing[@]}" -gt 0 ]; then
	echo "release: ${TAG} already exists for:" >&2
	printf '  %s\n' "${existing[@]}" >&2
	echo "release: a release tag is never re-pushed; cut the next one instead" >&2
	exit 1
fi

echo "release: ${TAG} is unclaimed across the roster (${#ALL_TARGETS[@]} images checked)"
