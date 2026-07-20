/**
 * Query narrowing for the outbox list.
 *
 * The outbox is a small, fully-loaded client-side list of mail that has not
 * left yet, so its search is a filter over the rows already in hand rather
 * than a request. It matches what an outbox row shows — subject, recipients
 * and sender — because that is what the user can see to search for.
 *
 * Filter tokens (`from:`, `is:unread`, dates) are not honored: an outbox row
 * has no read state, no mailbox and no received date, so the operators would
 * silently match nothing. The free text is used and the tokens are dropped
 * with the rest of the parse, same as any engine that cannot serve them.
 */

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
