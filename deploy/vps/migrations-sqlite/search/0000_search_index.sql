-- The thread-message search index, the one table in the tenant search database
-- (#1420). drizzle-kit cannot express an FTS5 virtual table, so this set is
-- custom SQL; packages/drizzle-service/src/search/thread-message-search.ts
-- declares the same columns for the statements that read and write it.
--
-- Three folded texts per thread message: the subject, the sender (from_name +
-- from_email) and the body preview the row carries (snippet). The trigram
-- tokenizer with remove_diacritics 1 makes MATCH an accent- and
-- case-insensitive substring search; a term under three characters falls back
-- to a folded LIKE over the mail rows instead.
--
-- The index is contentful: it keeps its own copy of the text, because the rows
-- it indexes live in the tenant mail database. Each document's rowid is derived
-- from its thread_message_id, so a write finds the document it replaces without
-- a lookup. The application writes it after each mail write and can rebuild it
-- from the mail database (`migrate --rebuild-search`); no trigger feeds it, and
-- it never commits together with the mail rows.
CREATE VIRTUAL TABLE IF NOT EXISTS thread_message_fts USING fts5(
	thread_message_id UNINDEXED,
	account_config_id UNINDEXED,
	subject,
	sender,
	body,
	tokenize='trigram remove_diacritics 1'
);
