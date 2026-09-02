import type { ResultCount } from "@remit/ui";

/**
 * Shortest free text a count is asked for. `npm-scripts/sqlite-search-index.sql`
 * documents that a query under three characters falls out of the trigram index
 * onto a folded `LIKE` scan, so counting one is a mailbox scan per typed
 * character. The list itself still pages — only the count waits.
 */
export const MIN_COUNTED_QUERY_LENGTH = 3;

export interface ResultCountRequestInput {
	/** True while the list is answering a search rather than plain browsing. */
	hasSearchQuery: boolean;
	/** The literal text of the search, with its filter tokens already taken out. */
	freeText: string;
	/**
	 * Tokens the request could not carry — `before:`, `after:`, `account:`, and
	 * any second value for a parameter that takes one — applied over the rows
	 * after they arrive.
	 */
	residualTokenCount: number;
}

/**
 * Whether the exact match count is worth one request against these criteria.
 *
 * Chip- and token-driven criteria are counted straight away: they change once
 * per click, and the predicate is one the index answers. Free text is counted
 * only once it is long enough to be indexed, which is what keeps a per-character
 * query from paying for a count it will throw away on the next keystroke.
 *
 * A residual token stops the count outright. The server never saw that term, so
 * it would count a wider set than the list shows — and two searches differing
 * only by one reach the request as the same criteria, so the answer would also
 * be the one the previous search left in the cache.
 */
export const shouldRequestResultCount = ({
	hasSearchQuery,
	freeText,
	residualTokenCount,
}: ResultCountRequestInput): boolean => {
	if (!hasSearchQuery) return false;
	if (residualTokenCount > 0) return false;
	const typed = freeText.trim();
	return typed.length === 0 || typed.length >= MIN_COUNTED_QUERY_LENGTH;
};

/**
 * The server's answer, or no number.
 *
 * The only input is `ThreadSearchResponse.count`, which is the whole match set
 * or absent (#305) — never a page length. Absent stays absent: a count the
 * server declined to compute is not zero, and the surface renders nothing
 * rather than a figure it made up.
 */
export const toResultCount = (count: number | undefined): ResultCount =>
	count === undefined ? { kind: "unknown" } : { kind: "exact", value: count };
