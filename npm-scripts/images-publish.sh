#!/usr/bin/env bash
# Build and push the RFC 035 D1 image roster (podman on the CI fleet, docker
# locally — whichever container-runtime.sh resolves).
#
# The CI fleet (self-hosted runners) has podman, not docker/buildx, so the
# Images workflow drives this instead of `docker buildx bake`. It also runs
# locally against docker; the docker-only equivalents remain `npm run
# docker:build` (per-target docker build) and `docker buildx bake`
# (docker-bake.hcl).
#
# The builder stage is built once up front; every target's final stage then
# reuses it from podman's local layer cache, so npm ci / make / vite / esbuild
# run once for all eight targets — the property docker-bake.hcl gets from a
# shared stage.
#
# Environment:
#   TAG          image tag to build and push (e.g. sha-<git-sha>). Required.
#   REGISTRY     registry/namespace prefix. Default ghcr.io/remit-mail/remit.
#   PUSH         "1" to push built tags, "0" to build only. Default "0".
#   PUSH_LATEST  "1" to also tag and push :latest. Default "0". Only main
#                should set this — a non-main run must not move :latest.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "${BASH_SOURCE[0]}")/lib/container-runtime.sh"

REGISTRY="${REGISTRY:-ghcr.io/remit-mail/remit}"
TAG="${TAG:?TAG is required (e.g. sha-<git-sha>)}"
PUSH="${PUSH:-0}"
PUSH_LATEST="${PUSH_LATEST:-0}"

ALL_TARGETS=(apisix backend imap-worker smtp-worker account-worker pg-index-worker search-index-worker web)
# These five share the Dockerfile's ARG-parameterized node-service-installed
# stage (SERVICE_NAME picks docker/runtime/<service>/package.json).
SERVICE_NAME_TARGETS=(backend imap-worker smtp-worker account-worker pg-index-worker)

service_name_arg() {
	local target="$1" s
	for s in "${SERVICE_NAME_TARGETS[@]}"; do
		if [ "$target" = "$s" ]; then
			printf -- '--build-arg\nSERVICE_NAME=%s\n' "$target"
			return
		fi
	done
}

echo "images-publish: building shared builder stage once"
"$CR" build --target builder -t "remit-builder:${TAG}" .

for target in "${ALL_TARGETS[@]}"; do
	echo "images-publish: building ${target}"
	mapfile -t build_args < <(service_name_arg "$target")
	tags=(-t "${REGISTRY}/${target}:${TAG}")
	if [ "$PUSH_LATEST" = "1" ]; then
		tags+=(-t "${REGISTRY}/${target}:latest")
	fi
	"$CR" build --target "$target" "${build_args[@]}" "${tags[@]}" .
done

if [ "$PUSH" != "1" ]; then
	echo "images-publish: PUSH=0, skipping push"
	exit 0
fi

for target in "${ALL_TARGETS[@]}"; do
	echo "images-publish: pushing ${REGISTRY}/${target}:${TAG}"
	"$CR" push "${REGISTRY}/${target}:${TAG}"
	if [ "$PUSH_LATEST" = "1" ]; then
		echo "images-publish: pushing ${REGISTRY}/${target}:latest"
		"$CR" push "${REGISTRY}/${target}:latest"
	fi
done
