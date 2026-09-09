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
 * rather than promising to show every match. Where no count ranks the folders —
 * a short query, a residual token, a failed request — the page's own junk rows
 * do, because they are the only evidence left of where the mail is.
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
	/**
	 * The count request failed. Distinct from `unknown`, which also covers a
	 * request still in flight or one nobody made: a failure is a folder that
	 * could not answer, and it must never read as a folder holding nothing.
	 */
	failed: boolean;
}

export interface SpamOffer {
	/** The junk folder "Go to Spam" scopes the search to. */
	mailboxId: string;
	/** Matches across every junk folder, or `unknown` if any went uncounted. */
	count: ResultCount;
}

export interface SpamOfferEvidence {
	/**
	 * Junk rows the loaded page held, per junk folder.
	 *
	 * Never the number the offer states — a page is a page. It is what says
	 * spam was reached at all while the counts are absent, and, crucially, WHICH
	 * folder the reader is being sent to: with no count to rank the folders by,
	 * the rows on screen are the only evidence of where the mail is, and a
	 * "Go to Spam" that lands on the wrong account's folder shows "No matches"
	 * over mail this very page is holding out.
	 */
	pageRowsByMailbox: ReadonlyMap<string, number>;
}

interface Candidate {
	mailboxId: string;
	count: ResultCount;
	failed: boolean;
	pageRows: number;
}

/**
 * How good a destination a folder is, before ties are broken.
 *
 * A counted match is the best evidence; junk rows on the page are the next
 * best, and they outrank the folder's own count because the rows are on screen
 * while the count may be half a minute old. A folder that answered zero and
 * shows no row ranks LAST — it is the only one known to hold nothing, so
 * sending the reader there is the one choice guaranteed to show an empty list.
 */
const tier = (candidate: Candidate): number => {
	if (candidate.count.kind === "exact" && candidate.count.value > 0) return 3;
	if (candidate.pageRows > 0) return 2;
	return candidate.count.kind === "unknown" ? 1 : 0;
};

const exactValue = (candidate: Candidate): number =>
	candidate.count.kind === "exact" ? candidate.count.value : 0;

/** Strict, so equal candidates leave the earlier one standing. */
const isBetterDestination = (
	candidate: Candidate,
	standing: Candidate,
): boolean => {
	if (tier(candidate) !== tier(standing)) {
		return tier(candidate) > tier(standing);
	}
	if (exactValue(candidate) !== exactValue(standing)) {
		return exactValue(candidate) > exactValue(standing);
	}
	return candidate.pageRows > standing.pageRows;
};

/**
 * The offer these per-folder counts support, or none.
 *
 * None when every junk folder answered and they sum to zero with no junk row on
 * the page either — the search reaches no spam. Anything else is an offer: rows
 * held out of the list are always offered a way back, because hiding mail
 * without one is worse than hiding a number.
 *
 * The figure is the sum, and only when every folder answered. One folder
 * missing takes it off, because summing the folders that replied states a
 * number exact in form and short in fact. A sum of zero over a page that is
 * holding junk rows takes it off too: the two disagree, so neither is stated.
 */
export function spamOfferFromCounts(
	counts: readonly SpamMailboxCount[],
	{ pageRowsByMailbox }: SpamOfferEvidence,
): SpamOffer | undefined {
	const candidates: Candidate[] = counts.map((entry) => ({
		...entry,
		pageRows: pageRowsByMailbox.get(entry.mailboxId) ?? 0,
	}));
	// A folder the page names but the counts do not — the mailbox lists are still
	// loading, or the folder arrived after the requests went out. Its rows are
	// already being held out of the list, so it has to be reachable.
	for (const [mailboxId, pageRows] of pageRowsByMailbox) {
		if (pageRows <= 0) continue;
		if (candidates.some((entry) => entry.mailboxId === mailboxId)) continue;
		candidates.push({
			mailboxId,
			count: { kind: "unknown" },
			failed: false,
			pageRows,
		});
	}

	const first = candidates[0];
	if (!first) return undefined;

	let total = 0;
	let everyFolderAnswered = true;
	let best = first;
	for (const candidate of candidates) {
		if (candidate.count.kind === "unknown") everyFolderAnswered = false;
		else total += candidate.count.value;
		if (isBetterDestination(candidate, best)) best = candidate;
	}

	const pageHeldSpam = candidates.some((candidate) => candidate.pageRows > 0);
	const anyFailed = candidates.some((candidate) => candidate.failed);
	if (total === 0 && !pageHeldSpam && (everyFolderAnswered || !anyFailed)) {
		return undefined;
	}

	// The count and the page disagree: an exact zero under rows the list is
	// holding out. The rows are on screen and the count is up to half a minute
	// old, so the offer stands and states nothing.
	const contradicted = everyFolderAnswered && total === 0 && pageHeldSpam;
	return {
		mailboxId: best.mailboxId,
		count:
			everyFolderAnswered && !contradicted
				? { kind: "exact", value: total }
				: { kind: "unknown" },
	};
}
