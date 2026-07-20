#!/usr/bin/env bash
# Destroy the source-built e2e stack: the app processes, the Dovecot container,
# and everything under .remit/e2e-dev — including the generated env, which is
# what tells `npm run e2e:test` this lane is the one running. Safe to run when
# nothing is up.
set -euo pipefail

# shellcheck source=./e2e-dev-compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-dev-compose.sh"

e2e_dev_stop_all

# The compose file interpolates E2E_IMAP_PASSWORD and errors without it, so the
# template is loaded even on a teardown that has nothing left to read.
[ -f "$DEV_ENV" ] && set -a && source "$DEV_ENV" && set +a
: "${E2E_IMAP_PASSWORD:=$(grep -E '^E2E_IMAP_PASSWORD=' "$DEV_TEMPLATE" | cut -d= -f2-)}"
export E2E_IMAP_PASSWORD

e2e_dev_compose down --volumes --remove-orphans
rm -rf "$DEV_STATE_DIR"
echo "e2e-dev: stack removed"
