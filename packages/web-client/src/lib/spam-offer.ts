/**
 * The Spam offer a global search makes: how many matches it held out, and the
 * mailbox that shows them.
 *
 * Scoping is a route, and a route names one mailbox, so the offer has to land in
 * one Spam folder even when several accounts matched. The count is therefore the
 * count *of that folder* rather than the cross-account total: the offer says how
 * many results taking it will show, so it can never promise more than it
 * delivers. With one account — and with spam matches in only one account, which
 * is the ordinary case — the two are the same number.
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
