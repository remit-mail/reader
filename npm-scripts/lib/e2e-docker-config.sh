#!/usr/bin/env bash
# Sourced by the e2e compose helpers, never run.
#
# The source-built lane sets HOME to its state dir, where the docker CLI finds
# no cli-plugins and `docker compose` fails as `unknown flag: --project-name`.
# Pinning DOCKER_CONFIG to the user's own ~/.docker keeps the plugin resolvable
# whatever HOME is later set to.
if [ -z "${DOCKER_CONFIG-}" ]; then
	e2e_user_home="$(getent passwd "$(id -u)" | cut -d: -f6)" || e2e_user_home=""
	DOCKER_CONFIG="${e2e_user_home:-$HOME}/.docker"
	export DOCKER_CONFIG
	unset e2e_user_home
fi
