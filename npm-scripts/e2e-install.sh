#!/usr/bin/env bash
# Install the e2e suite's own dependencies. Its unit checks need nothing more
# than this (`npm run test:e2e-unit`); the black-box specs add the browser shell
# on top (e2e-test.sh).
set -euo pipefail

# shellcheck source=./e2e-suite.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-suite.sh"

e2e_install
