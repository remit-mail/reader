#!/usr/bin/env bash
# Reports whether the Images workflow needs to build, writing the boolean to the
# job's GITHUB_OUTPUT (should_build) for the build/e2e jobs to gate on.
#
# A manual dispatch always builds — a human clicking Run means build now, even
# to re-run the packaged-edge e2e against an already-imaged tip — so it needs no
# registry read at all. A scheduled (nightly) run queries GHCR for every image
# in the roster at the tip's sha tag and builds only when the tip is not already
# fully imaged: a batch already built by hand during the day costs nothing
# overnight, and the nightly exists only to catch main commits that landed with
# no manual build (and to keep exercising the packaged-edge e2e the source-built
# pull-request lane skips).
#
# The registry read reuses the same manifest-inspect primitive as the release
# preflight (lib/manifest-check.sh, lib/image-roster.sh); the decision inverts
# it — here "already present" means SKIP, not the release's fatal "refuse"
# (lib/roster-publish.sh explains why any doubt builds rather than refuses).
#
# Environment:
#   TAG          tag to check (e.g. sha-<commit>). Required.
#   REGISTRY     registry/namespace prefix. Default ghcr.io/remit-mail/reader.
#   EVENT_NAME   github.event_name: workflow_dispatch always builds; anything
#                else (schedule) queries the registry.
#   OUTPUT_NAME  GITHUB_OUTPUT key to write. Default should_build.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=npm-scripts/lib/image-roster.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/image-roster.sh"
# shellcheck source=npm-scripts/lib/manifest-check.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/manifest-check.sh"
# shellcheck source=npm-scripts/lib/roster-publish.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/roster-publish.sh"

REGISTRY="${REGISTRY:-ghcr.io/remit-mail/reader}"
TAG="${TAG:?TAG is required (e.g. sha-<commit>)}"
EVENT_NAME="${EVENT_NAME:-}"
OUTPUT_NAME="${OUTPUT_NAME:-should_build}"

emit() {
	local value="$1"
	echo "images: ${OUTPUT_NAME}=${value}"
	if [ -n "${GITHUB_OUTPUT:-}" ]; then
		echo "${OUTPUT_NAME}=${value}" >>"$GITHUB_OUTPUT"
	fi
}

if [ "$EVENT_NAME" = "workflow_dispatch" ]; then
	echo "images: manual dispatch — building unconditionally"
	emit true
	exit 0
fi

image_roster
assert_roster_nonempty
echo "images: roster is ${ALL_TARGETS[*]} (${#ALL_TARGETS[@]} targets) at ${TAG}"

verdicts=()
for target in "${ALL_TARGETS[@]}"; do
	ref="${REGISTRY}/${target}:${TAG}"

	status=0
	output="$(docker manifest inspect "$ref" 2>&1)" || status=$?
	verdict="$(classify_manifest_check "$status" "$output")"
	echo "images: ${ref} -> ${verdict}"

	if [ "$verdict" = "abort" ]; then
		echo "images: could not confirm ${ref}; treating the tip as not-yet-imaged" >&2
		echo "$output" >&2
	fi
	verdicts+=("$verdict")
done

emit "$(roster_build_decision "${verdicts[@]}")"
