#!/usr/bin/env bash
# Run the black-box suite against an already-running e2e stack.
#
# Installs only what the suite needs (Playwright and an IMAP client); the
# monorepo is neither built nor installed for this.
set -euo pipefail

# shellcheck source=./e2e-compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-compose.sh"

E2E_DIR="$REPO_ROOT/e2e"

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
# looking at (e2e/src/stack.ts).
env_source="$DEPLOY_DIR/e2e.env"
[ -f "$DEPLOY_DIR/.env" ] && env_source="$DEPLOY_DIR/.env"
[ -f "$REPO_ROOT/.remit/e2e-dev/.env" ] && env_source="$REPO_ROOT/.remit/e2e-dev/.env"
while IFS= read -r line; do
	export "${line?}"
done < <(grep -E '^E2E_[A-Z_]+=' "$env_source")

cd "$E2E_DIR"

# When this script is reached through `npm run`, npm passes its own project down
# in npm_config_* — including npm_config_local_prefix, which points at the
# repository root. That makes the install below resolve the root's lockfile
# instead of this directory's. Drop the inherited configuration so the suite
# installs itself.
#
# `|| true` because npm also exports keys that are not valid shell identifiers
# (registry auth, scoped-registry settings); `unset` rejects those, and under
# `set -e` one of them would end the run.
while IFS='=' read -r name _; do
	unset "$name" || true
done < <(env | grep '^npm_')

if [ -f package-lock.json ]; then
	npm ci
else
	npm install
fi
# `--only-shell` fetches the headless shell and not the full Chrome build. The
# suite never runs headed, and the shell is a fraction of the download.
./node_modules/.bin/playwright install --with-deps --only-shell chromium
exec ./node_modules/.bin/playwright test "$@"
