import { or, type SQL, sql } from "drizzle-orm";
import { addressTable } from "../schema/i4-address.js";

// The address search seam. A term is matched as a substring of the display name,
// the local part, the domain and the whole address, and the order it comes back
// in is decided by which of those matched and where (#704).

const escapeLike = (term: string): string => term.replace(/[\\%_]/g, "\\$&");

const SEARCH_COLUMNS = [
	sql`lower(coalesce(${addressTable.displayName}, ''))`,
	sql`${addressTable.localPart}`,
	sql`${addressTable.domain}`,
	sql`${addressTable.normalizedEmail}`,
] as const;

/**
 * SQL `lower()` and `like` both fold ASCII only, so a column read through them
 * can never meet a term folded by JavaScript: `Öz` would miss `Özcan Bakker`.
 * `normalizedCompound` is written already folded by JavaScript, on the same
 * rules as the term, so matching it raw is what keeps a name outside ASCII
 * findable. It carries no column identity — the name and the address are
 * concatenated in it — so a row reached only this way scores no rank and sorts
 * last, which is where a fallback belongs.
 */
const FOLDED_FALLBACK = sql`${addressTable.normalizedCompound}`;

const like = (column: SQL, pattern: string): SQL =>
	sql`${column} like ${pattern} escape '\\'`;

const patterns = (term: string) => {
	const escaped = escapeLike(term.toLowerCase());
	return { leading: `${escaped}%`, anywhere: `%${escaped}%` };
};

export const addressSearchMatch = (term: string): SQL => {
	const { anywhere } = patterns(term);
	const matched = or(
		...[...SEARCH_COLUMNS, FOLDED_FALLBACK].map((column) =>
			like(column, anywhere),
		),
	);
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
	if (!term) return sql<number>`cast(0 as integer)`;
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

// `json_extract` raises on text that is not JSON, and this runs on every row in
// the account's scan — one unparseable `flags` value would take the whole
// account's autocomplete down rather than its own row.
const flagValue = (name: string): SQL<number> =>
	sql<number>`coalesce(json_extract(coalesce(nullif(${addressTable.flags}, ''), '{}'), ${`$.${name}.value`}), 0)`;

/** The account's own standing for the sender: a VIP first, then one it trusts. */
export const addressPreference = (): SQL<number> =>
	sql<number>`(2 * ${flagValue("vip")} + ${flagValue("trusted")})`;

export const addressCorrespondence = (): SQL<number> =>
	sql<number>`(${addressTable.replyCount} + ${addressTable.inboundCount} + ${addressTable.outboundCount})`;

export const addressRecency = (): SQL<number> =>
	sql<number>`max(${addressTable.lastInboundAt}, ${addressTable.lastReplyAt}, coalesce(${addressTable.lastOutboundAt}, 0))`;
