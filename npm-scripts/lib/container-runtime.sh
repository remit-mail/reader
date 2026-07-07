#!/usr/bin/env bash
# Resolve a container runtime, preferring podman and falling back to docker.
# Source this and use "$CR" for container commands.
#
#   source "$(dirname "$0")/lib/container-runtime.sh"
#   "$CR" ps

if command -v podman &>/dev/null; then
    CR="podman"
elif command -v docker &>/dev/null; then
    CR="docker"
else
    echo "error: neither podman nor docker found on PATH" >&2
    exit 1
fi

export CR
