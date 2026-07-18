-- SQLite full-text search objects (RFC 036 D4) — the sqlite counterpart of
-- npm-scripts/pg-search-index.sql, applied by the migrator as its final
-- idempotent step (deploy/vps/migrate/run-migrate.ts) and by the test harness
-- (packages/drizzle-service/src/test-db-sqlite.ts) so repos run the exact
-- search path they ship on.
--
-- An external-content FTS5 table over the same two folded texts the Postgres
-- GIN indexes cover: the subject, and the sender (from_name + from_email). The
-- trigram tokenizer with remove_diacritics 1 makes MATCH an accent- and
-- case-insensitive substring search — the same contract the UI has today, with
-- the two named per-target differences D4 accepts (a different diacritic-fold
-- table than Postgres unaccent, and sub-3-character queries falling back to an
-- unindexed folded LIKE scan in the query predicate, since trigram needs three
-- characters). Requires SQLite >= 3.45 for the trigram tokenizer's
-- remove_diacritics support; better-sqlite3 bundles a newer build.
--
-- content='thread_message' with content_rowid='rowid' links the index to the
-- base table's implicit rowid; the sender column is a computed concatenation,
-- so the triggers below feed every value explicitly (the standard
-- external-content pattern from the SQLite docs) and the index is never
-- 'rebuild'-ed — the triggers keep it in sync on every write.
--
-- Two constraints follow from the implicit-rowid + computed-column design:
--  * Do NOT run a plain `VACUUM` on this database. VACUUM renumbers rowids and
--    would silently desync the index from thread_message. The backup path uses
--    `VACUUM INTO` (RFC 036 D6), which copies to a new file and leaves the live
--    rowids untouched, so it is safe.
--  * The index cannot be scanned or `'rebuild'`-ed (its computed `sender` has no
--    content-table column). If it ever desyncs, recovery is drop + reinstall +
--    backfill: `DROP TABLE thread_message_fts`, then re-run the migrator, whose
--    newly-created guard repopulates it from thread_message.

CREATE VIRTUAL TABLE IF NOT EXISTS thread_message_fts USING fts5(
	subject,
	sender,
	content='thread_message',
	content_rowid='rowid',
	tokenize='trigram remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS thread_message_fts_ai
AFTER INSERT ON thread_message BEGIN
	INSERT INTO thread_message_fts(rowid, subject, sender)
	VALUES (
		new.rowid,
		coalesce(new.subject, ''),
		coalesce(new.from_name, '') || ' ' || coalesce(new.from_email, '')
	);
END;

CREATE TRIGGER IF NOT EXISTS thread_message_fts_ad
AFTER DELETE ON thread_message BEGIN
	INSERT INTO thread_message_fts(thread_message_fts, rowid, subject, sender)
	VALUES (
		'delete',
		old.rowid,
		coalesce(old.subject, ''),
		coalesce(old.from_name, '') || ' ' || coalesce(old.from_email, '')
	);
END;

-- Scoped to the indexed columns only: is_read / star / is_deleted flips are the
-- hottest thread_message writes and must not re-tokenize two documents each.
CREATE TRIGGER IF NOT EXISTS thread_message_fts_au
AFTER UPDATE OF subject, from_name, from_email ON thread_message BEGIN
	INSERT INTO thread_message_fts(thread_message_fts, rowid, subject, sender)
	VALUES (
		'delete',
		old.rowid,
		coalesce(old.subject, ''),
		coalesce(old.from_name, '') || ' ' || coalesce(old.from_email, '')
	);
	INSERT INTO thread_message_fts(rowid, subject, sender)
	VALUES (
		new.rowid,
		coalesce(new.subject, ''),
		coalesce(new.from_name, '') || ' ' || coalesce(new.from_email, '')
	);
END;
