/**
 * The Spam offer: how much of a search sits in Spam, and where taking the offer
 * lands.
 *
 * Both answers come from one server count per junk folder the search reached
 * (`useSpamMatchCounts`). The number is their sum, because a search spans every
 * account and every account has its own Spam folder — "N in Spam" that named
 * one folder's share would be smaller than the mail the phrase describes.
 *
 * The destination is a single folder even so: scoping is a route and a route
 * names one mailbox. It is the folder holding the most matches, which is the
 * best a single click can do, and `SpamResultsOffer` says where the button goes
 * rather than promising to show every match.
 *
 * This used to group the search results the header held and count each group.
 * That array is a page, so the figure was a count of the loaded window offered
 * as a count of a mailbox: a Spam match below the page was missing from it, and
 * the number climbed as further pages loaded (#313).
 *
 * A folder whose count did not arrive makes the total `unknown`. Summing the
 * ones that did would state a figure that is exact in form and short in fact,
 * and nothing distinguishes it from a true one on screen.
 */
import type { ResultCount } from "@remit/ui";

export interface SpamMailboxCount {
	mailboxId: string;
	count: ResultCount;
}

export interface SpamOffer {
	/** The junk folder "Go to Spam" scopes the search to. */
	mailboxId: string;
	/** Matches across every junk folder, or `unknown` if any went uncounted. */
	count: ResultCount;
}

export interface SpamOfferEvidence {
	/**
	 * Whether the rows the caller loaded held a spam match. It is the fallback
	 * for whether there is anything to offer, used only while no folder has
	 * reported a match of its own — never as the number. A page saying "at least
	 * one" is worth something; a page saying "eight" is not.
	 */
	pageHeldSpam: boolean;
}

/**
 * The offer these per-folder counts support, or none.
 *
 * None when there is no junk folder, and none when every folder answered
 * exactly and they sum to zero — the search reaches no spam wherever the caller
 * has paged to. One folder answering with a match is enough to offer even while
 * another has not answered; the figure then goes, because summing only the
 * folders that replied states a number that is exact in form and short in fact.
 * With nothing positive known at all, the caller's own page decides whether
 * spam was reached.
 */
export function spamOfferFromCounts(
	counts: readonly SpamMailboxCount[],
	{ pageHeldSpam }: SpamOfferEvidence,
): SpamOffer | undefined {
	const first = counts[0];
	if (!first) return undefined;

	let total = 0;
	let exact = true;
	let best = first;
	let bestValue = 0;
	for (const entry of counts) {
		if (entry.count.kind === "unknown") {
			exact = false;
			continue;
		}
		total += entry.count.value;
		// Strictly greater, so the first folder wins a tie and the destination does
		// not flip between renders of the same counts.
		if (entry.count.value > bestValue) {
			bestValue = entry.count.value;
			best = entry;
		}
	}

	if (exact && total === 0) return undefined;
	if (!exact && total === 0 && !pageHeldSpam) return undefined;
	return {
		mailboxId: best.mailboxId,
		count: exact ? { kind: "exact", value: total } : { kind: "unknown" },
	};
}
