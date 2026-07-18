#!/bin/sh
# Nightly encrypted SQLite backup sidecar.
#
# VACUUM INTO each database file -> gzip -> age-encrypt -> rclone copy to an
# operator-supplied S3-compatible bucket, then prune anything older than
# BACKUP_RETENTION_DAYS.
#
# VACUUM INTO is SQLite's online-backup primitive: it reads a consistent
# snapshot of a live WAL database into a new, defragmented file without
# blocking writers for more than a moment. Two files are snapshotted: the
# app/auth database (SQLITE_DB_PATH) and the sqlite-vec vector store
# (LOCAL_VECTORDB_PATH). The vector file is a rebuildable projection (embeddings
# re-derive from IMAP on reindex), but snapshotting it is cheap and saves a full
# re-embed after a restore.
#
# Runs in a plain sleep loop, not a cron daemon — the interval is one number
# (BACKUP_INTERVAL_SECONDS, default 24h) and the container already restarts
# under `restart: unless-stopped`.
#
# `--run-once` re-invokes this same script as a separate `sh` process rather
# than a shell function so `set -eu -o pipefail` is not suspended inside an
# `if !` test (POSIX shells suspend `set -e` for a function body that is itself
# the condition of `if`/`!`/`&&`/`||`). A separate process aborts on the first
# failure — a failed VACUUM, a failed age, a failed upload — and its exit code
# is what the outer loop's `if !` sees, instead of silently "succeeding".
if [ "${1:-}" = "--run-once" ]; then
	set -eu
	set -o pipefail

	: "${SQLITE_DB_PATH:?set SQLITE_DB_PATH in .env}"
	: "${LOCAL_VECTORDB_PATH:?set LOCAL_VECTORDB_PATH in .env}"
	: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT in .env — see the Backups section in remit.env.template}"
	: "${BACKUP_RCLONE_REMOTE:?set BACKUP_RCLONE_REMOTE in .env — see the Backups section in remit.env.template}"
	RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

	timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
	work_dir="$(mktemp -d)"
	trap 'rm -rf "$work_dir"' EXIT

	# db=app/auth relational store, vec=sqlite-vec vector store. Each is
	# VACUUM INTO'd to a fresh snapshot, then encrypted independently so a
	# restore can put either file back on its own.
	for pair in "db:$SQLITE_DB_PATH" "vec:$LOCAL_VECTORDB_PATH"; do
		label="${pair%%:*}"
		src="${pair#*:}"
		snapshot="$work_dir/remit-${label}-${timestamp}.db"
		out_file="/tmp/remit-${label}-${timestamp}.db.gz.age"

		# The vector file is created by the search-index-worker on its first
		# embedding write, so on a fresh stack it does not exist yet. sqlite3
		# opens read-write and would CREATE an empty database at the missing
		# path on the shared volume, out from under the writer that owns it —
		# skip until the writer has made the file.
		if [ ! -f "$src" ]; then
			echo "backup: ${src} (${label}) does not exist yet — skipping"
			continue
		fi

		echo "backup: VACUUM INTO snapshot of ${src} (${label}) at ${timestamp}"
		sqlite3 "$src" "VACUUM INTO '$snapshot'"

		echo "backup: encrypting ${label} snapshot -> ${out_file}"
		gzip -c "$snapshot" | age -r "$BACKUP_AGE_RECIPIENT" -o "$out_file"
		rm -f "$snapshot"

		echo "backup: uploading ${out_file} to ${BACKUP_RCLONE_REMOTE}"
		rclone copy "$out_file" "$BACKUP_RCLONE_REMOTE"
		rm -f "$out_file"
	done

	echo "backup: pruning backups older than ${RETENTION_DAYS} days"
	rclone delete --min-age "${RETENTION_DAYS}d" "$BACKUP_RCLONE_REMOTE"

	echo "backup: done"
	exit 0
fi

set -eu
: "${BACKUP_RCLONE_REMOTE:?set BACKUP_RCLONE_REMOTE in .env — see the Backups section in remit.env.template}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"

echo "backup: sqlite sidecar started — interval ${INTERVAL_SECONDS}s, retention ${RETENTION_DAYS}d, remote ${BACKUP_RCLONE_REMOTE}"

while true; do
	# A failed backup logs loudly and retries on the next interval — it does
	# not crash the sidecar (a transient network blip shouldn't need a human to
	# restart the container), but it also does not retry sooner: watch the logs,
	# this is the thing to alert on. See deploy/vps/README.md.
	if ! sh "$0" --run-once; then
		echo "backup: FAILED at $(date -u +%Y-%m-%dT%H:%M:%SZ) — will retry after the next interval" >&2
	fi
	sleep "$INTERVAL_SECONDS"
done
