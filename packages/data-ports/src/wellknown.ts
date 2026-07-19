/**
 * Wellknown promotion rule (issue #233).
 *
 * Pure predicate over an Address engagement snapshot. Returns `true` when
 * the address should be auto-promoted to `flags.wellknown.value === true`.
 *
 * Three conjuncts:
 *   1. `flags.wellknown.value` is not already `true` (idempotent).
 *   2. Engagement threshold:
 *      - `replyCount >= 1` always promotes (a real two-way conversation).
 *      - `inboundCount >= 3` promotes ONLY for non-bulk senders. Bulk senders
 *        (newsletters, marketing, automated, or List-Unsubscribe present) reach
 *        high inbound counts by volume alone — that is not engagement. Only a
 *        real reply from the user (`replyCount >= 1`) promotes a bulk sender.
 *   3. `lastInboundAt` exists and is within the last 90 days
 *      (keeps dormant senders from being promoted by stale counters).
 *
 * The body-sync inbound path always writes `lastInboundAt = now`, so the
 * 90-day check trivially passes there. The SMTP reply path reads the
 * existing `lastInboundAt` (the user is replying to an inbound, which
 * implies a recent inbound, but we still gate on it explicitly).
 */

export const WELLKNOWN_INBOUND_THRESHOLD = 3;
export const WELLKNOWN_REPLY_THRESHOLD = 1;
export const WELLKNOWN_INBOUND_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Categories and signals that make a sender "bulk". Bulk senders cannot be
 * promoted by inbound volume alone — only a real reply promotes them.
 */
const BULK_CATEGORIES: ReadonlySet<string> = new Set([
	"newsletter",
	"marketing",
	"automated",
]);

export interface WellknownEngagementSnapshot {
	inboundCount?: number;
	replyCount?: number;
	lastInboundAt?: number;
	/**
	 * Whether this sender is a bulk/automated sender (newsletter, marketing,
	 * automated category, or List-Unsubscribe header present). Bulk senders
	 * can only be promoted via `replyCount >= 1`, not by inbound volume.
	 */
	isBulk?: boolean;
	flags?: {
		wellknown?: { value: boolean } | undefined;
	};
}

export const shouldPromoteWellknown = (
	snapshot: WellknownEngagementSnapshot,
	now: number,
): boolean => {
	if (snapshot.flags?.wellknown?.value === true) return false;

	const replyCount = snapshot.replyCount ?? 0;
	const inboundCount = snapshot.inboundCount ?? 0;
	const replied = replyCount >= WELLKNOWN_REPLY_THRESHOLD;
	// Bulk senders are only promotable via a real reply, not inbound volume.
	const inboundEnough =
		!snapshot.isBulk && inboundCount >= WELLKNOWN_INBOUND_THRESHOLD;
	if (!replied && !inboundEnough) return false;

	const lastInboundAt = snapshot.lastInboundAt;
	if (lastInboundAt === undefined) return false;
	if (now - lastInboundAt > WELLKNOWN_INBOUND_WINDOW_MS) return false;

	return true;
};

/**
 * Returns true when the category or presence of List-Unsubscribe marks the
 * sender as bulk, meaning they cannot be promoted by inbound volume alone.
 */
export function isBulkSender(
	category: string | undefined,
	hasListUnsubscribe: boolean,
): boolean {
	if (hasListUnsubscribe) return true;
	if (category != null && BULK_CATEGORIES.has(category)) return true;
	return false;
}
