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
# reuses it from the runtime's local layer cache, so npm ci / make / vite /
# esbuild run once for all eight targets — the property docker-bake.hcl gets
# from a shared stage.
#
# CI lanes are ephemeral, so their local layer cache starts empty every run.
# When CACHE_REF is set, unchanged layers (base images, the workspace npm ci)
# are pulled from a registry cache instead of rebuilt. The lane must be
# authenticated to that registry; the Images workflow already logs into GHCR.
#
# Environment:
#   TAG          image tag to build and push (e.g. sha-<git-sha>). Required.
#   REGISTRY     registry/namespace prefix. Default ghcr.io/remit-mail/reader.
#   PUSH         "1" to push built tags, "0" to build only. Default "0".
#   PUSH_LATEST  "1" to also tag and push :latest. Default "0". Only main
#                should set this — a non-main run must not move :latest.
#   CACHE_REF    registry repo for the layer cache (e.g.
#                ghcr.io/remit-mail/reader/cache). Unset disables registry
#                caching; the build still reuses the local layer cache.
#   CACHE_TO     "0" to read the cache but not write it, for lanes without
#                registry write access. Default "1" when CACHE_REF is set.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "${BASH_SOURCE[0]}")/lib/container-runtime.sh"

REGISTRY="${REGISTRY:-ghcr.io/remit-mail/reader}"
TAG="${TAG:?TAG is required (e.g. sha-<git-sha>)}"
PUSH="${PUSH:-0}"
PUSH_LATEST="${PUSH_LATEST:-0}"
CACHE_REF="${CACHE_REF:-}"
CACHE_TO="${CACHE_TO:-1}"

# shellcheck source=npm-scripts/lib/image-roster.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/image-roster.sh"
image_roster
assert_roster_nonempty
echo "images-publish: roster is ${ALL_TARGETS[*]} (${#ALL_TARGETS[@]} targets)"

# The node-service targets share the Dockerfile's ARG-parameterized
# node-service-installed stage (SERVICE_NAME picks docker/runtime/<service>/
# package.json). web and search-index-worker have dedicated Dockerfile stages,
# apisix its own — so any other present docker/runtime target is a SERVICE_NAME
# target.
service_name_arg() {
	local target="$1"
	case "$target" in
	apisix | web | search-index-worker) return ;;
	esac
	[ -d "docker/runtime/$target" ] &&
		printf -- '--build-arg\nSERVICE_NAME=%s\n' "$target"
}

# Registry cache flags for one build. Podman content-addresses cache layers
# under a single repo, so every build shares CACHE_REF directly. Docker/buildkit
# keys a cache export to one ref, so each slot gets its own tag and every target
# also reads the shared builder slot that holds the expensive workspace layers.
cache_args() {
	local slot="$1"
	[ -z "$CACHE_REF" ] && return 0
	if [ "$CR" = podman ]; then
		printf -- '--layers\n--cache-from\n%s\n' "$CACHE_REF"
		[ "$CACHE_TO" = "1" ] && printf -- '--cache-to\n%s\n' "$CACHE_REF"
		return
	fi
	printf -- '--cache-from\ntype=registry,ref=%s:builder\n' "$CACHE_REF"
	if [ "$slot" != builder ]; then
		printf -- '--cache-from\ntype=registry,ref=%s:%s\n' "$CACHE_REF" "$slot"
	fi
	[ "$CACHE_TO" = "1" ] && printf -- '--cache-to\ntype=registry,ref=%s:%s,mode=max\n' "$CACHE_REF" "$slot"
}

echo "images-publish: building shared builder stage once"
mapfile -t builder_cache < <(cache_args builder)
"$CR" build --target builder "${builder_cache[@]}" -t "remit-builder:${TAG}" .

for target in "${ALL_TARGETS[@]}"; do
	echo "images-publish: building ${target}"
	mapfile -t build_args < <(service_name_arg "$target")
	mapfile -t target_cache < <(cache_args "$target")
	tags=(-t "${REGISTRY}/${target}:${TAG}")
	if [ "$PUSH_LATEST" = "1" ]; then
		tags+=(-t "${REGISTRY}/${target}:latest")
	fi
	"$CR" build --target "$target" "${build_args[@]}" "${target_cache[@]}" "${tags[@]}" .
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
