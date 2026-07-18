import { type SQL, sql } from "drizzle-orm";
import { isSqlite } from "../dialect.js";

// Accent- and case-insensitive substring match over the whole mailbox, isolated
// here as the one text-search seam that genuinely differs by dialect (RFC 036
// D1). The subject and sender predicates match the DynamoDB `contains()`
// substring contract: LIKE metacharacters (`\`, `%`, `_`) are escaped in JS so
// the needle arrives as bind-parameter text, and the escaped form is treated
// literally.

const escapeLike = (term: string): string => term.replace(/[\\%_]/g, "\\$&");

// ─── Postgres ────────────────────────────────────────────────────────────────
// The folded expressions must reproduce the indexed expressions in
// npm-scripts/pg-search-index.sql exactly (immutable unaccent + lower over the
// coalesced text) so the planner uses the trigram GIN indexes. Matching runs
// over the whole mailbox — Postgres indexes the text, so there is no
// recent-window read bound.
const PG_SUBJECT_FOLDED = sql`remit_immutable_unaccent(lower(coalesce(subject, '')))`;
const PG_FROM_FOLDED = sql`remit_immutable_unaccent(lower(coalesce(from_name, '') || ' ' || coalesce(from_email, '')))`;

const pgLikePattern = (term: string): SQL =>
	sql`'%' || remit_immutable_unaccent(lower(${escapeLike(term)})) || '%'`;

const pgSubjectMatch = (term: string): SQL =>
	sql`${PG_SUBJECT_FOLDED} like ${pgLikePattern(term)}`;
const pgFromMatch = (term: string): SQL =>
	sql`${PG_FROM_FOLDED} like ${pgLikePattern(term)}`;

// ─── SQLite ──────────────────────────────────────────────────────────────────
// Text search on SQLite is the external-content FTS5 trigram index that
// npm-scripts/sqlite-search-index.sql installs (RFC 036 D4): `thread_message_fts`
// indexes the folded subject and sender, and MATCH is an accent- and
// case-insensitive substring search (the tokenizer folds both sides, so the
// needle is passed through untransformed). The predicate is a `rowid IN
// (subquery)` over that index — the outer WHERE still narrows by mailbox.
//
// Trigram indexing needs three characters, so a one- or two-character term
// falls back to the unindexed folded LIKE scan D4 names — lower() both sides,
// substring-match, `escape '\'` making the JS-escaped metacharacters literal.
// It is case-insensitive for ASCII and does not fold diacritics; the accepted
// per-target difference from Postgres `unaccent`.

// FTS5 treats bare query text as its match grammar (AND/OR/NEAR/`*`/`-`/`:`), so
// wrap the term as a double-quoted string literal — doubling embedded quotes —
// to match it verbatim as a trigram substring.
const ftsPhrase = (term: string): string => `"${term.replace(/"/g, '""')}"`;

// Trigram tokenization is by character, so measure the term in code points, not
// UTF-16 units — a two-astral-character term is still under the three-char
// index floor.
const isTrigramIndexable = (term: string): boolean => [...term].length >= 3;

const ftsRowidMatch = (matchExpr: string): SQL =>
	sql`"thread_message"."rowid" in (select "rowid" from "thread_message_fts" where "thread_message_fts" match ${matchExpr})`;

const SQLITE_SUBJECT_FOLDED = sql`lower(coalesce(subject, ''))`;
const SQLITE_FROM_FOLDED = sql`lower(coalesce(from_name, '') || ' ' || coalesce(from_email, ''))`;

const sqliteLikePattern = (term: string): SQL =>
	sql`'%' || lower(${escapeLike(term)}) || '%'`;

const sqliteSubjectMatch = (term: string): SQL =>
	isTrigramIndexable(term)
		? ftsRowidMatch(`subject : ${ftsPhrase(term)}`)
		: sql`${SQLITE_SUBJECT_FOLDED} like ${sqliteLikePattern(term)} escape '\\'`;

const sqliteFromMatch = (term: string): SQL =>
	isTrigramIndexable(term)
		? ftsRowidMatch(`sender : ${ftsPhrase(term)}`)
		: sql`${SQLITE_FROM_FOLDED} like ${sqliteLikePattern(term)} escape '\\'`;

// ─── Dialect selection ───────────────────────────────────────────────────────

export const subjectMatch = (term: string): SQL =>
	isSqlite() ? sqliteSubjectMatch(term) : pgSubjectMatch(term);

export const fromMatch = (term: string): SQL =>
	isSqlite() ? sqliteFromMatch(term) : pgFromMatch(term);
