-- The search index tokenizes words with unicode61, folding case and
-- diacritics, in place of trigrams (#1444). The table is dropped and created
-- again empty; the migrate step rebuilds it from the mail database, since its
-- document count no longer matches the thread messages.
DROP TABLE IF EXISTS thread_message_fts;
--> statement-breakpoint
CREATE VIRTUAL TABLE thread_message_fts USING fts5(
	thread_message_id UNINDEXED,
	account_config_id UNINDEXED,
	mailbox_id UNINDEXED,
	sent_date UNINDEXED,
	list_id UNINDEXED,
	subject,
	sender,
	body,
	tokenize='unicode61 remove_diacritics 2'
);
