#!/usr/bin/env bash
# One-time split of a self-host instance's single SQLite file into the app,
# tenant mail and tenant search databases (#1420).
#
#   npm-scripts/split-sqlite.sh <deployment-dir> [source] [app] [mail] [search]
#
# Run it once on the host, from a checkout or with this file copied beside the
# deployment, after the release that splits the database is pulled and before
# the stack starts on it. It stops the stack, then runs split-sqlite.mjs from the
# backend image through the migrate service, which mounts the database volume
# and carries the migration sets. The paths are inside that volume; the
# defaults are the old file and the three the compose file configures.
set -euo pipefail

if [ $# -lt 1 ]; then
	sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
	exit 64
fi

deployment=$1
source=${2:-/data/sqlite/remit.db}
app=${3:-/data/sqlite/app.db}
mail=${4:-/data/sqlite/mail.db}
search=${5:-/data/sqlite/search.db}

cd "$deployment"
docker compose -f docker-compose.sqlite.yml stop
docker compose -f docker-compose.sqlite.yml run --rm --no-deps migrate \
	node split-sqlite.mjs \
	--source "$source" --app "$app" --mail "$mail" --search "$search"
