#!/usr/bin/env bash
# Tail the e2e stack's logs. Takes optional service names:
#   npm run e2e:logs -- imap-worker backend
set -euo pipefail

# shellcheck source=./e2e-compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-compose.sh"

e2e_install_env
e2e_compose logs --follow --tail 200 "$@"
