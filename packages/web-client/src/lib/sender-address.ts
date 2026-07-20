import type { RemitImapAddressResponse } from "@remit/api-http-client/types.gen.ts";

/**
 * `GET /addresses/search` is a prefix search over both the display-name
 * compound and the normalized email, so a query for one sender's address can
 * legitimately return several rows (`sup@x.com` also prefixes `support@x.com`,
 * and any display name starting with the same characters matches too).
 *
 * Asking for a single row and taking `items[0]` is therefore wrong twice over:
 * the row it returns may belong to a different sender, and the row we actually
 * want may be past the cut. Fetch a small window instead and pick the exact
 * address out of it.
 */
export const SENDER_ADDRESS_SEARCH_LIMIT = 10;

/** Query params for the sender-address lookup. One shape, used by every caller. */
export const senderAddressSearchQuery = (
	senderEmail: string | undefined,
): { q: string; limit: number } => ({
	q: senderEmail?.toLowerCase() ?? "",
	limit: SENDER_ADDRESS_SEARCH_LIMIT,
});

/**
 * Select the address row for exactly this sender. A prefix match on another
 * sender is not this sender, so it resolves to `undefined` rather than the
 * wrong address — silently flagging the wrong sender is worse than not
 * resolving.
 */
export const pickSenderAddress = (
	items: RemitImapAddressResponse[] | undefined,
	senderEmail: string | undefined,
): RemitImapAddressResponse | undefined => {
	if (!senderEmail) return undefined;
	const normalized = senderEmail.toLowerCase();
	return items?.find((item) => item.normalizedEmail === normalized);
};
