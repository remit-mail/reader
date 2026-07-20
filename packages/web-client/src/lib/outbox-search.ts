/**
 * Query narrowing for the outbox list.
 *
 * The outbox is a small, fully-loaded client-side list of mail that has not
 * left yet, so its search is a filter over the rows already in hand rather
 * than a request. It matches what an outbox row shows — subject, recipients
 * and sender — because that is what the user can see to search for.
 *
 * Filter tokens (`from:`, `is:unread`, dates) are not honored: an outbox row
 * has no read state, no mailbox and no received date, so the operators have
 * nothing to read. Only the free text narrows, so `Q3 from:billing` still
 * matches on "Q3".
 *
 * A query made only of tokens asks for a filter this view cannot apply, and
 * there is no free text left to fall back on. Rather than return every row as
 * if the filter had been honored, that case returns nothing and the list says
 * why — see `outboxQueryIsUnsupported`.
 */
import type { ParsedSearchQuery } from "./search-tokens";

/** The outbox row fields a query is matched against. */
export interface OutboxSearchRow {
	subject?: string | null;
	fromAddress?: string | null;
	fromName?: string | null;
	toAddresses?: readonly string[] | null;
	ccAddresses?: readonly string[] | null;
}

export function matchesOutboxSearch(
	row: OutboxSearchRow,
	freeText: string,
): boolean {
	const needle = freeText.trim().toLowerCase();
	if (needle.length === 0) return true;
	const haystack = [
		row.subject,
		row.fromAddress,
		row.fromName,
		...(row.toAddresses ?? []),
		...(row.ccAddresses ?? []),
	]
		.filter((value): value is string => typeof value === "string")
		.join(" ")
		.toLowerCase();
	return needle
		.split(/\s+/)
		.every((word) => word.length === 0 || haystack.includes(word));
}

/**
 * True when the query is nothing but filter tokens. The outbox can serve none
 * of them, and matching on the empty free text left over would return every
 * row — indistinguishable from a filter that matched everything.
 */
export function outboxQueryIsUnsupported(parsed: ParsedSearchQuery): boolean {
	return parsed.tokens.length > 0 && parsed.freeText.trim().length === 0;
}
