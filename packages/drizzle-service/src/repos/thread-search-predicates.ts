import { type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { threadMessageSearchTable as fts } from "../search/thread-message-search.js";

// Accent- and case-insensitive substring match over the whole mailbox, isolated
// here as the one text-search seam whose behaviour is engine-specific. The
// subject and sender predicates match the `contains()` substring contract:
// LIKE metacharacters (`\`, `%`, `_`) are escaped in JS so the needle arrives as
// bind-parameter text, and the escaped form is treated literally.

const escapeLike = (term: string): string => term.replace(/[\\%_]/g, "\\$&");

// Every predicate here is a condition over `thread_message_fts`, the FTS5
// trigram index in the tenant search database (#1420). It indexes the folded
// subject, the sender and the body preview the row carries, and MATCH is an
// accent- and case-insensitive substring search (the tokenizer folds both
// sides, so the needle is passed through untransformed). The predicate is a
// `rowid IN (subquery)` over the same table, so terms combine with AND and OR
// like any other condition.
//
// Trigram indexing needs three characters, so a one- or two-character term
// falls back to a folded LIKE scan of the index's own copy of the text —
// lower() both sides, substring-match, `escape '\'` making the JS-escaped
// metacharacters literal. It is case-insensitive for ASCII and does not fold
// diacritics; the accepted difference between a short term and an indexed one
// (contract C10).

// FTS5 treats bare query text as its match grammar (AND/OR/NEAR/`*`/`-`/`:`), so
// wrap the term as a double-quoted string literal — doubling embedded quotes —
// to match it verbatim as a trigram substring.
const ftsPhrase = (term: string): string => `"${term.replace(/"/g, '""')}"`;

// Trigram tokenization is by character, so measure the term in code points, not
// UTF-16 units — a two-astral-character term is still under the three-char
// index floor.
const isTrigramIndexable = (term: string): boolean => [...term].length >= 3;

const isAscii = (term: string): boolean =>
	[...term].every((char) => (char.codePointAt(0) ?? 0) < 128);

/**
 * Whether a term can be pushed into the query without dropping a row the
 * caller's own matcher would accept.
 *
 * Below the trigram floor the predicate is the folded LIKE, and SQLite's
 * `lower()` folds ASCII only: `é` never matches a stored `CAFÉ`. For a search
 * box that is the accepted C10 difference between a short term and an indexed
 * one. For a NARROWING it is not — a narrowing that misses is the #459 defect
 * again, one clause shape at a time — so such a term is not narrowable at all
 * and the caller widens instead.
 */
export const isNarrowableTerm = (term: string): boolean =>
	isTrigramIndexable(term) || isAscii(term);

const ftsRowidMatch = (matchExpr: string): SQL =>
	sql`${fts}.rowid in (select rowid from ${fts} where ${fts} match ${matchExpr})`;

const likePattern = (term: string): SQL =>
	sql`'%' || lower(${escapeLike(term)}) || '%'`;

const folded = (column: SQLWrapper, term: string): SQL =>
	sql`lower(${column}) like ${likePattern(term)} escape '\\'`;

export const subjectMatch = (term: string): SQL =>
	isTrigramIndexable(term)
		? ftsRowidMatch(`subject : ${ftsPhrase(term)}`)
		: folded(fts.subject, term);

export const fromMatch = (term: string): SQL =>
	isTrigramIndexable(term)
		? ftsRowidMatch(`sender : ${ftsPhrase(term)}`)
		: folded(fts.sender, term);

/**
 * Match the body text the row carries: the stored preview, quoted replies
 * already removed, which is the same text the list renders under the subject.
 *
 * The brief used to reach this text with a pass over the rows a page had
 * loaded, so what a search found depended on how far the reader had scrolled
 * (#1135). It is a column like the other two, so it belongs in the index and in
 * the predicate. A term further into a long message is still out of reach —
 * the preview is what is stored — but a term the reader can see on the row is
 * now found wherever that row sits in the collection.
 */
export const bodyMatch = (term: string): SQL =>
	isTrigramIndexable(term)
		? ftsRowidMatch(`body : ${ftsPhrase(term)}`)
		: folded(fts.body, term);

// The List-Id is carried unindexed, so a List-Id term is always the folded LIKE
// scan. It is the narrowing half of a rule back-apply (#459).
export const listIdMatch = (term: string): SQL => folded(fts.listId, term);

export const senderMatchRank = (terms: readonly string[]): SQL<number> =>
	terms.length === 0
		? sql<number>`0`
		: sql<number>`case when ${sql.join(terms.map(fromMatch), sql` or `)} then 1 else 0 end`;
