#!/bin/sh
# The one SQLite snapshot primitive on this box (RFC 037 R8).
#
# Sourced, never executed: the nightly backup sidecar and `remit update` both
# take their snapshot through snapshot_db, so a self-update and a backup can
# never disagree about what a snapshot is. backup-sqlite.sh cannot be called by
# the updater as it stands — it requires an age recipient and an rclone remote,
# writes to a path of its own choosing, and prunes the remote — so the shared
# part is this function rather than that script.
#
# VACUUM INTO is SQLite's online-backup primitive: it reads a consistent
# snapshot of a live WAL database into a fresh, defragmented file without
# blocking writers for more than a moment. Copying the file instead loses every
# transaction still in the write-ahead log, and the restore looks clean.

# snapshot_db <source-database> <destination-file>
#
# A source that does not exist yet is a complete snapshot, not a failure: the
# vector store is created by the search-index worker on its first embedding
# write, so a young instance legitimately has none. Opening the missing path
# would CREATE an empty database on the shared volume out from under the writer
# that owns it, so the absence is answered here rather than by sqlite3.
snapshot_db() {
	_snapshot_src=$1
	_snapshot_dest=$2

	if [ ! -f "$_snapshot_src" ]; then
		printf 'snapshot: %s does not exist yet — skipping\n' "$_snapshot_src"
		return 0
	fi

	printf 'snapshot: VACUUM INTO %s -> %s\n' "$_snapshot_src" "$_snapshot_dest"
	sqlite3 "$_snapshot_src" "VACUUM INTO '$_snapshot_dest'"
}
