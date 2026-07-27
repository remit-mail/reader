#!/usr/bin/env bash
# Shared by e2e-test.sh (the black-box specs, against a running stack) and
# e2e-unit.sh (the suite's own unit checks, against nothing). Sourced, never run.
#
# The suite is its own npm project. It installs Playwright and an IMAP client;
# the monorepo is neither built nor installed for it. One definition of where
# the suite lives and how it installs itself, so the two entry points cannot
# drift.
set -euo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/e2e"

# When this script is reached through `npm run`, npm passes its own project down
# in npm_config_* — including npm_config_local_prefix, which points at the
# repository root. That makes the install below resolve the root's lockfile
# instead of this directory's. Drop the inherited configuration so the suite
# installs itself.
#
# `|| true` because npm also exports keys that are not valid shell identifiers
# (registry auth, scoped-registry settings); `unset` rejects those, and under
# `set -e` one of them would end the run.
e2e_install() {
	cd "$E2E_DIR"

	while IFS='=' read -r name _; do
		unset "$name" || true
	done < <(env | grep '^npm_')

	if [ -f package-lock.json ]; then
		npm ci
	else
		npm install
	fi
}
