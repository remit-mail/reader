#!/usr/bin/env bash
# Show the source-built stack's logs. Takes optional service names:
#   npm run e2e:dev:logs -- backend imap-worker
#
# The app services log to files under .remit/e2e-dev/logs; the containers log to
# docker. Both are printed. E2E_LOGS_TAIL sets how far back each is read.
set -euo pipefail

# shellcheck source=./e2e-dev-compose.sh
source "$(dirname "${BASH_SOURCE[0]}")/e2e-dev-compose.sh"

tail_lines="${E2E_LOGS_TAIL:-200}"
services=("$@")
if [ ${#services[@]} -eq 0 ]; then
	services=(queue backend imap-worker smtp-worker account-worker web dovecot mailpit)
fi

for service in "${services[@]}"; do
	echo "===== $service ====="
	if [ "$service" = "dovecot" ] || [ "$service" = "mailpit" ]; then
		[ -f "$DEV_ENV" ] && set -a && source "$DEV_ENV" && set +a
		e2e_dev_compose logs --no-color --tail "$tail_lines" "$service"
		continue
	fi
	tail -n "$tail_lines" "$DEV_LOG_DIR/$service.log" 2>/dev/null ||
		echo "(no log — $service was not started)"
done
