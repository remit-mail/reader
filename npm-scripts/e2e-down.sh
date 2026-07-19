#!/usr/bin/env bash
# Destroy the e2e stack: containers, volumes, and the generated .env. Safe to
# run when nothing is up.
set -euo pipefail

# shellcheck source=./e2e-compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-compose.sh"

e2e_install_env
e2e_compose down --volumes --remove-orphans
rm -f "$DEPLOY_DIR/.env"
echo "e2e: stack removed"
