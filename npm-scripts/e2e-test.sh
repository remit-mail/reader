#!/usr/bin/env bash
# Run the black-box suite against an already-running e2e stack.
#
# Installs only what the suite needs (Playwright and an IMAP client); the
# monorepo is neither built nor installed for this.
set -euo pipefail

# shellcheck source=./e2e-compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-compose.sh"

E2E_DIR="$REPO_ROOT/packages/e2e"

# The running stack's own configuration is the suite's configuration, so the two
# cannot point at different ports. Each lane's `up` writes a generated env and
# its `down` deletes it, so whichever file is present names the stack that is
# actually running: the source-built lane's first, then the image lane's, then
# the image lane's committed template as the last resort. A generated file is
# preferred over a template because it carries any override the caller applied;
# later assignments in it win, which is how those overrides take effect.
#
# Only the E2E_* keys are exported — the rest configures the stack, and one of
# them (NODE_ENV=production) would change how npm installs below. E2E_STACK
# rides along on that prefix, which is how a spec learns which deployment it is
# looking at (packages/e2e/src/stack.ts).
env_source="$DEPLOY_DIR/e2e.env"
[ -f "$DEPLOY_DIR/.env" ] && env_source="$DEPLOY_DIR/.env"
[ -f "$REPO_ROOT/.remit/e2e-dev/.env" ] && env_source="$REPO_ROOT/.remit/e2e-dev/.env"
while IFS= read -r line; do
	export "${line?}"
done < <(grep -E '^E2E_[A-Z_]+=' "$env_source")

cd "$E2E_DIR"

# Two things point the install below at the repository root instead of at this
# directory, and both have to be undone for the suite to install only itself.
#
# The first is inherited configuration: reached through `npm run`, npm passes its
# own project down in npm_config_* — including npm_config_local_prefix, which
# names the repository root. `|| true` because npm also exports keys that are not
# valid shell identifiers (registry auth, scoped-registry settings); `unset`
# rejects those, and under `set -e` one of them would end the run.
#
# The second is that the suite is a workspace of the root project, which is what
# puts it under `npm run typecheck` (#440). npm walks up from the working
# directory, finds the manifest that declares this package a workspace, and takes
# that as the project — so a bare `npm ci` here installs the whole monorepo and
# runs its postinstall. `--prefix` names the project outright and is not subject
# to that walk.
while IFS='=' read -r name _; do
	unset "$name" || true
done < <(env | grep '^npm_')

if [ -f package-lock.json ]; then
	npm ci --prefix "$PWD"
else
	npm install --prefix "$PWD"
fi
# `--only-shell` fetches the headless shell and not the full Chrome build. The
# suite never runs headed, and the shell is a fraction of the download.
./node_modules/.bin/playwright install --with-deps --only-shell chromium
exec ./node_modules/.bin/playwright test "$@"
