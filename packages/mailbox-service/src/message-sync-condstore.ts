import type { ImapMessage } from "./types.js";

/**
 * Watermark arithmetic for the CONDSTORE (RFC 7162) incremental fetch path
 * (issue #20). Kept apart from the sync service because it is pure: a
 * mod-sequence comparison decides what a round may skip and how far the stored
 * watermark may move, and that decision is worth reading and testing on its
 * own.
 */

/**
 * A mod-sequence is an unsigned 64-bit value, so it is stored as decimal
 * digits and only ever compared as a BigInt. `undefined` covers rows written
 * before the field existed, and "0" is the server's own way of saying it has
 * no mod-sequence to report.
 */
export const parseModseq = (raw: string | undefined): bigint => {
	if (!raw) return 0n;
	const value = BigInt(raw);
	return value > 0n ? value : 0n;
};

/**
 * Order a CHANGEDSINCE result by mod-sequence, oldest change first.
 *
 * Mod-sequence order is what makes a partial round resumable: a batch taken
 * off the front of this list can advance the watermark to the last change it
 * applied, and the next round resumes at exactly that point. UID breaks ties
 * so the order is total.
 */
export const orderByModseq = (messages: ImapMessage[]): ImapMessage[] =>
	[...messages].sort((a, b) => {
		const left = parseModseq(a.modseq);
		const right = parseModseq(b.modseq);
		if (left === right) return a.uid - b.uid;
		return left < right ? -1 : 1;
	});

export interface ModseqAdvanceInput {
	/** Watermark this round started from. */
	storedModseq: bigint;
	/** HIGHESTMODSEQ the server reported before this round fetched anything. */
	serverModseq: bigint;
	/** The full changed set, in {@link orderByModseq} order. */
	ordered: ImapMessage[];
	/** The prefix of `ordered` this round actually processed. */
	batch: ImapMessage[];
	/** UIDs whose save threw and must be re-fetched. */
	failedUids: ReadonlySet<number>;
}

export interface ModseqAdvance {
	/** The watermark to persist, as decimal digits. */
	highestModseq: string;
	/** True when changes remain that this round did not process. */
	hasMore: boolean;
}

/**
 * Decide how far the stored watermark may move after a round.
 *
 * The watermark may only pass a change that is already durably applied, so it
 * advances over the leading run of successes and stops at the first failure —
 * an interrupted round re-fetches its window instead of skipping it.
 *
 * When the round consumed the whole changed set without a failure the
 * watermark jumps to the server's HIGHESTMODSEQ instead of the last message's
 * mod-sequence. Those are not the same number: a mod-sequence also moves for
 * events that return no message (an expunge, a change to a message the fetch
 * filtered out), and stopping short of it would re-deliver every one of them
 * on every subsequent round. That value is read before the fetch, so anything
 * that changes while the round runs lands above it and arrives next time.
 */
export const advanceModseqWatermark = ({
	storedModseq,
	serverModseq,
	ordered,
	batch,
	failedUids,
}: ModseqAdvanceInput): ModseqAdvance => {
	let applied = storedModseq;
	let failed = false;

	for (const message of batch) {
		if (failedUids.has(message.uid)) {
			failed = true;
			break;
		}
		const modseq = parseModseq(message.modseq);
		if (modseq > applied) applied = modseq;
	}

	const hasMore = ordered.length > batch.length;
	const complete = !failed && !hasMore;

	if (complete && serverModseq > applied) {
		return { highestModseq: serverModseq.toString(), hasMore };
	}

	return { highestModseq: applied.toString(), hasMore };
};
