import { type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { threadMessageSearchTable as fts } from "../search/thread-message-search.js";

// Every predicate here is a condition over `thread_message_fts`, the FTS5 index
// in the tenant search database (#1420), tokenized `unicode61
// remove_diacritics 2`: it indexes words, folding case and diacritics. A
// search term matches words that start with it, so "matt" finds "Matthijs",
// and a term the tokenizer splits ("ada@example") matches those words in a
// row. The predicate is a `rowid IN (subquery)` over the same table, so terms
// combine with AND and OR like any other condition.
//
// A term with no letter or digit has no word to match and falls back to a
// folded LIKE scan of the index's own copy of the text, as do the field-term
// narrowings, whose contract is substring: lower() both sides,
// substring-match, `escape '\'` making the JS-escaped metacharacters literal.
// The scan folds ASCII case only (contract C10).

const escapeLike = (term: string): string => term.replace(/[\\%_]/g, "\\$&");

// Quoted, so the term is tokenized as a phrase rather than read as FTS5 query
// grammar; the trailing `*` makes its last word a prefix.
const ftsPrefixPhrase = (term: string): string =>
	`"${term.replace(/"/g, '""')}" *`;

const hasWord = (term: string): boolean => /[\p{L}\p{N}]/u.test(term);

const isAscii = (term: string): boolean =>
	[...term].every((char) => (char.codePointAt(0) ?? 0) < 128);

/**
 * Whether a field term can be pushed into the query without dropping a row the
 * caller's own matcher would accept. The narrowing is a substring LIKE, and
 * SQLite's `lower()` folds ASCII only: `é` never matches a stored `CAFÉ`, so a
 * non-ASCII term is not narrowable and the caller widens instead (#459).
 */
export const isNarrowableTerm = (term: string): boolean => isAscii(term);

const ftsRowidMatch = (matchExpr: string): SQL =>
	sql`${fts}.rowid in (select rowid from ${fts} where ${fts} match ${matchExpr})`;

const likePattern = (term: string): SQL =>
	sql`'%' || lower(${escapeLike(term)}) || '%'`;

const folded = (column: SQLWrapper, term: string): SQL =>
	sql`lower(${column}) like ${likePattern(term)} escape '\\'`;

const wordMatch = (column: "subject" | "sender" | "body", term: string): SQL =>
	hasWord(term)
		? ftsRowidMatch(`${column} : ${ftsPrefixPhrase(term)}`)
		: folded(fts[column], term);

export const subjectMatch = (term: string): SQL => wordMatch("subject", term);

export const fromMatch = (term: string): SQL => wordMatch("sender", term);

export const bodyMatch = (term: string): SQL => wordMatch("body", term);

export const subjectContains = (term: string): SQL => folded(fts.subject, term);

export const fromContains = (term: string): SQL => folded(fts.sender, term);

// The List-Id is carried unindexed, so a List-Id term is always the folded LIKE
// scan. It is the narrowing half of a rule back-apply (#459).
export const listIdMatch = (term: string): SQL => folded(fts.listId, term);

export const senderMatchRank = (terms: readonly string[]): SQL<number> =>
	terms.length === 0
		? sql<number>`0`
		: sql<number>`case when ${sql.join(terms.map(fromMatch), sql` or `)} then 1 else 0 end`;
