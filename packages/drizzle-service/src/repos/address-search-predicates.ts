import { or, type SQL, sql } from "drizzle-orm";
import { addressTable } from "../schema/i4-address.js";

// The address search seam. A term is matched as a substring of the display name,
// the local part, the domain and the whole address, and the order it comes back
// in is decided by which of those matched and where (#704). `normalizedCompound`
// is deliberately not searched: it concatenates the name and the address, which
// destroys the one thing the ranking needs.

const escapeLike = (term: string): string => term.replace(/[\\%_]/g, "\\$&");

const SEARCH_COLUMNS = [
	sql`lower(coalesce(${addressTable.displayName}, ''))`,
	sql`${addressTable.localPart}`,
	sql`${addressTable.domain}`,
	sql`${addressTable.normalizedEmail}`,
] as const;

const like = (column: SQL, pattern: string): SQL =>
	sql`${column} like ${pattern} escape '\\'`;

const patterns = (term: string) => {
	const escaped = escapeLike(term.toLowerCase());
	return { leading: `${escaped}%`, anywhere: `%${escaped}%` };
};

/**
 * Parenthesised by `or()` rather than joined: an unbracketed `or` chain binds
 * looser than the `and` that scopes the query to one account, which would let a
 * search reach another account's addresses.
 */
export const addressSearchMatch = (term: string): SQL => {
	const { anywhere } = patterns(term);
	const matched = or(...SEARCH_COLUMNS.map((column) => like(column, anywhere)));
	if (matched === undefined) throw new Error("no address column to search");
	return matched;
};

/**
 * Where the term hit, as one number: every match at the start of a column
 * outranks every match in the middle of one, and within each the display name
 * outranks the local part, the domain and the whole address. A mid-string match
 * still comes back — this only decides the order.
 */
export const addressMatchRank = (term: string | undefined): SQL<number> => {
	// Not the bare literal `0`: SQLite reads an integer literal in ORDER BY as a
	// column index and rejects it as out of range.
	if (term === undefined) return sql<number>`cast(0 as integer)`;
	const { leading, anywhere } = patterns(term);
	const arms = [
		...SEARCH_COLUMNS.map((column) => like(column, leading)),
		...SEARCH_COLUMNS.map((column) => like(column, anywhere)),
	].map(
		(condition, index) =>
			sql`when ${condition} then ${SEARCH_COLUMNS.length * 2 - index}`,
	);
	return sql<number>`case ${sql.join(arms, sql` `)} else 0 end`;
};

const flagValue = (name: string): SQL<number> =>
	sql<number>`coalesce(json_extract(${addressTable.flags}, ${`$.${name}.value`}), 0)`;

/** The account's own standing for the sender: a VIP first, then one it trusts. */
export const addressPreference = (): SQL<number> =>
	sql<number>`(2 * ${flagValue("vip")} + ${flagValue("trusted")})`;

export const addressCorrespondence = (): SQL<number> =>
	sql<number>`(${addressTable.replyCount} + ${addressTable.inboundCount} + ${addressTable.outboundCount})`;

export const addressRecency = (): SQL<number> =>
	sql<number>`max(${addressTable.lastInboundAt}, ${addressTable.lastReplyAt}, coalesce(${addressTable.lastOutboundAt}, 0))`;
