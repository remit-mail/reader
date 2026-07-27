#!/usr/bin/env bash
# The e2e suite's own unit checks (e2e/unit). They exercise the suite's API
# client against a stubbed `fetch`: no deployment, no stack, no browser, which
# is why they run with the unit tests rather than in either e2e lane.
set -euo pipefail

# shellcheck source=./e2e-suite.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-suite.sh"

e2e_install
exec npm run test:unit
