/**
 * Where taking the Spam offer lands.
 *
 * Scoping is a route and a route names one mailbox, so the offer has to pick a
 * single Spam folder even when several accounts matched; it picks the one
 * holding the most matches. `count` is that folder's share, used only to choose
 * between folders — the banner states the full number of rows held out, which
 * the results list counts for itself.
 */
import { partitionSpamResults, type SearchResult } from "@remit/ui";

export interface SpamOffer {
	mailboxId: string;
	count: number;
}

export function spamOfferForResults(
	results: readonly SearchResult[],
): SpamOffer | undefined {
	const { spam } = partitionSpamResults([...results]);
	const countByMailbox = new Map<string, number>();
	for (const result of spam) {
		if (!result.mailboxId) continue;
		countByMailbox.set(
			result.mailboxId,
			(countByMailbox.get(result.mailboxId) ?? 0) + 1,
		);
	}

	let offer: SpamOffer | undefined;
	// Insertion order is result order, so the first-seen folder wins a tie and
	// the offer does not flip between renders of the same results.
	for (const [mailboxId, count] of countByMailbox) {
		if (!offer || count > offer.count) offer = { mailboxId, count };
	}
	return offer;
}
