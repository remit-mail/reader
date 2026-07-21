#!/usr/bin/env bash
# Refuse a release when any image in the roster already exists at the tag
# being released. A release tag is never re-pushed — a botched release is
# fixed by cutting the next one (npm run release:tag), never by overwriting
# this one.
#
# Always uses `docker`, never $CR. Podman's `manifest inspect` only
# understands manifest lists — verified live against GHCR that it fails to
# parse one of this roster's real images ("Treating single images as
# manifest lists is not implemented") even when the tag exists, because
# images-publish.sh builds a plain single-platform manifest per target, not a
# manifest list. Docker's `manifest inspect` reads both correctly, and both
# tools ship on the runner this workflow runs on (actions/runner-images
# ubuntu-24.04 carries Docker 28 and Podman 4.9 side by side), so this isn't
# an availability gap — a registry read just doesn't need to share the
# build/push step's runtime choice.
#
# A tag reads as absent only on the registry's own "manifest unknown" — the
# response for a missing tag in a package that has been published before (see
# lib/manifest-check.sh). Every other failure — a network error, an auth
# problem, a typo'd REGISTRY — aborts instead of being read as "free", because
# misreading any of those as free is exactly the mistake this script exists to
# prevent: it would let a release build proceed and overwrite a tag it never
# actually checked.
#
# One case this deliberately still fails closed: GHCR answers a package that
# has never been published at all with "denied", not "manifest unknown" —
# also confirmed live. The first release after adding a new
# docker/runtime/<service> blocks here until images.yml has published that
# service to main at least once. That's intended, not a bug to route around.
#
# Environment:
#   TAG       tag to check (e.g. v1.4.1). Required.
#   REGISTRY  registry/namespace prefix. Default ghcr.io/remit-mail/reader.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=npm-scripts/lib/image-roster.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/image-roster.sh"
# shellcheck source=npm-scripts/lib/manifest-check.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/manifest-check.sh"

REGISTRY="${REGISTRY:-ghcr.io/remit-mail/reader}"
TAG="${TAG:?TAG is required (e.g. v1.4.1)}"

image_roster
assert_roster_nonempty
echo "release: roster is ${ALL_TARGETS[*]} (${#ALL_TARGETS[@]} targets)"

existing=()
for target in "${ALL_TARGETS[@]}"; do
	ref="${REGISTRY}/${target}:${TAG}"
	echo "release: checking ${ref}"

	status=0
	output="$(docker manifest inspect "$ref" 2>&1)" || status=$?

	case "$(classify_manifest_check "$status" "$output")" in
	exists)
		existing+=("$ref")
		;;
	absent) ;;
	abort)
		echo "release: could not determine whether ${ref} exists; refusing to guess" >&2
		echo "$output" >&2
		exit 1
		;;
	esac
done

if [ "${#existing[@]}" -gt 0 ]; then
	echo "release: ${TAG} already exists for:" >&2
	printf '  %s\n' "${existing[@]}" >&2
	echo "release: a release tag is never re-pushed; cut the next one instead" >&2
	exit 1
fi

echo "release: ${TAG} is unclaimed across the roster (${#ALL_TARGETS[@]} images checked)"
