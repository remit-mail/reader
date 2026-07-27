#!/usr/bin/env bash
# Where the e2e suite lives and how it installs itself. Shared by e2e-test.sh
# (the black-box specs, against a running stack) and e2e-install.sh (which the
# unit checks run through). Sourced, never run.
#
# The suite is its own npm project. It installs Playwright and an IMAP client;
# the monorepo is neither built nor installed for it.
#
# E2E_SUITE_DIR is the one definition of the path, and `test:e2e-unit` repeats it
# as a literal so the reachability guard can read which package it runs. The two
# are asserted equal by npm-scripts/lib/e2e-suite.test.mjs — that assertion
# exists because moving the suite is a live prospect (#445 puts it under
# `packages/`) and a half-applied move is otherwise silent.
set -euo pipefail

E2E_SUITE_DIR="e2e"
E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/$E2E_SUITE_DIR"

# Two things point the install below at the repository root instead of at this
# directory, and both have to be undone for the suite to install only itself.
#
# The first is inherited configuration: reached through `npm run`, npm passes its
# own project down in npm_config_* — including npm_config_local_prefix, which
# names the repository root. `|| true` because npm also exports keys that are not
# valid shell identifiers (registry auth, scoped-registry settings); `unset`
# rejects those, and under `set -e` one of them would end the run.
#
# The second is that the suite may itself be a workspace of the root project,
# which is what would put it under `npm run typecheck` (#440, #445). npm walks up
# from the working directory, finds the manifest that declares this package a
# workspace, and takes that as the project — so a bare `npm ci` here installs the
# whole monorepo and runs its postinstall. `--prefix` names the project outright
# and is not subject to that walk.
e2e_install() {
	cd "$E2E_DIR"

	while IFS='=' read -r name _; do
		unset "$name" || true
	done < <(env | grep '^npm_')

	if [ -f package-lock.json ]; then
		npm ci --prefix "$PWD"
	else
		npm install --prefix "$PWD"
	fi
}
