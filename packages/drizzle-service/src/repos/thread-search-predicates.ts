import { type SQL, sql } from "drizzle-orm";

// Accent- and case-insensitive substring match over the whole mailbox, isolated
// here as the one text-search seam whose behaviour is engine-specific. The
// subject and sender predicates match the `contains()` substring contract:
// LIKE metacharacters (`\`, `%`, `_`) are escaped in JS so the needle arrives as
// bind-parameter text, and the escaped form is treated literally.

const escapeLike = (term: string): string => term.replace(/[\\%_]/g, "\\$&");

// Text search is the external-content FTS5 trigram index that
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
// difference between a short term and an indexed one (contract C10).

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

const SUBJECT_FOLDED = sql`lower(coalesce(subject, ''))`;
const FROM_FOLDED = sql`lower(coalesce(from_name, '') || ' ' || coalesce(from_email, ''))`;

const likePattern = (term: string): SQL =>
	sql`'%' || lower(${escapeLike(term)}) || '%'`;

export const subjectMatch = (term: string): SQL =>
	isTrigramIndexable(term)
		? ftsRowidMatch(`subject : ${ftsPhrase(term)}`)
		: sql`${SUBJECT_FOLDED} like ${likePattern(term)} escape '\\'`;

export const fromMatch = (term: string): SQL =>
	isTrigramIndexable(term)
		? ftsRowidMatch(`sender : ${ftsPhrase(term)}`)
		: sql`${FROM_FOLDED} like ${likePattern(term)} escape '\\'`;
