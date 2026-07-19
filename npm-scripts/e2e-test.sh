#!/usr/bin/env bash
# Run the black-box suite against an already-running e2e stack.
#
# Installs only what the suite needs (Playwright and an IMAP client); the
# monorepo is neither built nor installed for this.
set -euo pipefail

# shellcheck source=./e2e-compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-compose.sh"

E2E_DIR="$REPO_ROOT/e2e"

# The stack's own configuration is the suite's configuration — one file, so the
# two can never point at different ports or mailboxes. Only the E2E_* keys are
# exported: the rest of that file configures the containers, and some of it
# (NODE_ENV=production) would change how npm installs here.
while IFS= read -r line; do
	export "${line?}"
done < <(grep -E '^E2E_[A-Z_]+=' "$DEPLOY_DIR/e2e.env")

cd "$E2E_DIR"

# When this script is reached through `npm run`, npm passes its own project down
# in npm_config_* — including npm_config_local_prefix, which points at the
# repository root. That makes the install below resolve the root's lockfile
# instead of this directory's. Drop the inherited configuration so the suite
# installs itself.
while IFS='=' read -r name _; do
	unset "$name"
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
