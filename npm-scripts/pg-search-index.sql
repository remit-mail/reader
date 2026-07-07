-- Native full-text search objects for the pg-parity mail search (#1162).
--
-- The type-ahead search box matches senders and subjects. On DynamoDB the
-- match is a case-sensitive substring filter over the most-recent rows of a
-- mailbox (contains() has no index). Postgres can index the text, so here the
-- match is an accent- and case-insensitive substring lookup over the WHOLE
-- mailbox, served by trigram GIN indexes.
--
-- Kept out of the drizzle schema on purpose (same reason as
-- pg-outbox-trigger.sql): `drizzle-kit push` and the extension-less embedded
-- Postgres unit harness both push the drizzle schema, and these objects need
-- the immutable unaccent wrapper plus the pg_trgm/unaccent extensions. Applied
-- idempotently after push; the extensions themselves are enabled in the pg
-- setup scripts (pg-start.sh / pg-reset.sh), alongside pgvector.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() is only STABLE, so it cannot appear in an index expression.
-- Wrapping the fixed 'unaccent' dictionary in an IMMUTABLE function is the
-- documented way to make it indexable.
CREATE OR REPLACE FUNCTION remit_immutable_unaccent(text)
	RETURNS text
	LANGUAGE sql
	IMMUTABLE PARALLEL SAFE STRICT
	AS $$ SELECT unaccent('unaccent', $1) $$;

-- Trigram GIN indexes on the folded (lowercased, accent-stripped) subject and
-- sender text. The "from" index folds display name and email together so one
-- predicate covers both. The query predicates in the repository reproduce these
-- expressions exactly so the planner uses the indexes.
CREATE INDEX IF NOT EXISTS tm_search_subject_trgm ON thread_message
	USING gin (remit_immutable_unaccent(lower(coalesce(subject, ''))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tm_search_from_trgm ON thread_message
	USING gin (
		remit_immutable_unaccent(
			lower(coalesce(from_name, '') || ' ' || coalesce(from_email, ''))
		) gin_trgm_ops
	);
