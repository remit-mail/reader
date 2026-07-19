#!/usr/bin/env bash
# Tail the e2e stack's logs. Takes optional service names:
#   npm run e2e:logs -- imap-worker backend
#
# Following is for a human watching a run. A CI lane collecting diagnostics
# needs the command to end, so set E2E_LOGS_FOLLOW=0; E2E_LOGS_TAIL sets how far
# back each service is read.
set -euo pipefail

# shellcheck source=./e2e-compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-compose.sh"

follow=()
[ "${E2E_LOGS_FOLLOW:-1}" = "1" ] && follow=(--follow)

e2e_install_env
e2e_compose logs "${follow[@]}" --no-color --tail "${E2E_LOGS_TAIL:-200}" "$@"
