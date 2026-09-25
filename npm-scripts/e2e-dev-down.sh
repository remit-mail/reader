#!/usr/bin/env bash
# Destroy the source-built e2e stack: the app processes, the Dovecot and Mailpit
# containers, and everything under .remit/e2e-dev — including the generated env,
# which is what tells `npm run e2e:test` this lane is the one running. Safe to
# run when nothing is up.
set -euo pipefail

# shellcheck source=./e2e-dev-compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-dev-compose.sh"

e2e_dev_teardown
echo "e2e-dev: stack removed"
