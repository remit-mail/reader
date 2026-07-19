import type { ImapMessage } from "./types.js";

/**
 * Cursor arithmetic for message sync.
 *
 * One rule governs every function here: a cursor may never move past work
 * that has not been durably applied. A watermark that steps over a message —
 * because a batch was cut in the wrong place, or because a failure sat below
 * a success — drops that message for good, since every selection this service
 * makes is a comparison against the watermark and nothing else.
 *
 * The rule applies on two axes: mod-sequence (the CONDSTORE path) and UID
 * (the enumeration path).
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
 * Order a CHANGEDSINCE result by mod-sequence, oldest change first, UID
 * breaking ties.
 *
 * Mod-sequence order is what makes a partial round resumable: a batch taken
 * off the front can advance the watermark to the last change it applied and
 * the next round resumes there.
 */
export const orderByModseq = (messages: ImapMessage[]): ImapMessage[] =>
	[...messages].sort((a, b) => {
		const left = parseModseq(a.modseq);
		const right = parseModseq(b.modseq);
		if (left === right) return a.uid - b.uid;
		return left < right ? -1 : 1;
	});

/**
 * Take a batch off the front of an ordered changed set without splitting a
 * mod-sequence.
 *
 * One STORE assigns the SAME mod-sequence to every message it touched — RFC
 * 7162 permits it and servers do it — so "mark 60 messages read" arrives as
 * 60 messages sharing one value. CHANGEDSINCE is strictly greater-than, so a
 * watermark landing inside such a group would never return the group's tail:
 * mark 60 read with a batch size of 50 and 10 stay unread forever.
 *
 * The batch therefore ends on a mod-sequence boundary. It stops short of the
 * straddling group; a single group larger than the batch size is taken whole,
 * because it can only be applied entirely or not at all.
 */
export const takeModseqBatch = (
	ordered: ImapMessage[],
	batchSize: number,
): ImapMessage[] => {
	if (ordered.length <= batchSize) return [...ordered];

	const straddled = parseModseq(ordered[batchSize - 1].modseq);

	let end = batchSize;
	while (end > 0 && parseModseq(ordered[end - 1].modseq) === straddled) end--;

	if (end === 0) {
		end = batchSize;
		while (
			end < ordered.length &&
			parseModseq(ordered[end].modseq) === straddled
		) {
			end++;
		}
	}

	return ordered.slice(0, end);
};

export interface ModseqAdvanceInput {
	/** Watermark this round started from. */
	storedModseq: bigint;
	/** HIGHESTMODSEQ the server reported before this round fetched anything. */
	serverModseq: bigint;
	/** The full changed set, in {@link orderByModseq} order. */
	ordered: ImapMessage[];
	/** The prefix of `ordered` this round processed — see {@link takeModseqBatch}. */
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
 * Decide how far the mod-sequence watermark may move after a round.
 *
 * The watermark stops strictly below the lowest mod-sequence this round left
 * unprocessed — unprocessed because the batch ended before it, or because its
 * save threw. Clamping below that value rather than at the last success is
 * what makes a shared mod-sequence safe: one failure holds back every message
 * carrying the same value, and they all return next round.
 *
 * When the round consumed the whole changed set without a failure the
 * watermark jumps to the server's HIGHESTMODSEQ instead of the last message's
 * mod-sequence. Those are not the same number: a mod-sequence also moves for
 * events that return no message (an expunge, a change to a message the fetch
 * filtered out), and stopping short of it would re-deliver every one of them
 * on every subsequent round. That value is read before the fetch, so anything
 * changing while the round runs lands above it and arrives next time.
 */
export const advanceModseqWatermark = ({
	storedModseq,
	serverModseq,
	ordered,
	batch,
	failedUids,
}: ModseqAdvanceInput): ModseqAdvance => {
	const unprocessed = [
		...ordered.slice(batch.length),
		...batch.filter((message) => failedUids.has(message.uid)),
	].map((message) => parseModseq(message.modseq));

	const limit = unprocessed.length
		? unprocessed.reduce((lowest, value) => (value < lowest ? value : lowest))
		: null;

	let applied = storedModseq;
	for (const message of batch) {
		if (failedUids.has(message.uid)) continue;
		const modseq = parseModseq(message.modseq);
		if (limit !== null && modseq >= limit) continue;
		if (modseq > applied) applied = modseq;
	}

	if (limit === null && serverModseq > applied) {
		applied = serverModseq;
	}

	return {
		highestModseq: applied.toString(),
		hasMore: ordered.length > batch.length,
	};
};

export interface UidWatermarkInput {
	/** UIDs this round fetched. */
	batchUids: number[];
	/** UIDs whose save threw. */
	failedUids: ReadonlySet<number>;
	/** Lowest UID synced so far — the backfill floor. 0 before any sync. */
	lastSyncUid: number;
	/** Highest UID synced so far — the forward watermark. */
	highWaterMarkUid: number;
}

export interface UidWatermarks {
	lastSyncUid: number;
	highWaterMarkUid: number;
}

/**
 * Decide how far each UID watermark may move after a round.
 *
 * The two watermarks bound disjoint regions — new mail above
 * `highWaterMarkUid`, backfill below `lastSyncUid` — so a failure constrains
 * only the watermark whose region it sits in.
 *
 * The forward watermark stops below the lowest failure above it. Raising it
 * over a failed UID would drop that UID out of the selection set entirely,
 * and the following round, finding nothing left to enumerate, would seed the
 * mod-sequence watermark over a message that was never stored. The backfill
 * floor stays above the highest failure below it, for the same reason in the
 * other direction.
 */
export const advanceUidWatermarks = ({
	batchUids,
	failedUids,
	lastSyncUid,
	highWaterMarkUid,
}: UidWatermarkInput): UidWatermarks => {
	const isFreshSync = lastSyncUid === 0;

	const forwardUids = batchUids.filter((uid) => uid > highWaterMarkUid);
	const forwardFailures = forwardUids.filter((uid) => failedUids.has(uid));
	const forwardLimit = forwardFailures.length
		? Math.min(...forwardFailures)
		: Number.POSITIVE_INFINITY;
	const forwardApplied = forwardUids.filter(
		(uid) => !failedUids.has(uid) && uid < forwardLimit,
	);
	const nextHighWaterMark = Math.max(highWaterMarkUid, ...forwardApplied);

	const backfillUids = batchUids.filter(
		(uid) => isFreshSync || uid < lastSyncUid,
	);
	const backfillFailures = backfillUids.filter((uid) => failedUids.has(uid));
	// The floor must stay strictly above a failed UID for it to stay selectable.
	const backfillFloor = backfillFailures.length
		? Math.max(...backfillFailures) + 1
		: 0;
	const backfillApplied = backfillUids.filter(
		(uid) => !failedUids.has(uid) && uid >= backfillFloor,
	);

	// The floor drops to the lowest UID applied above the failure line, or to
	// the line itself when everything below it is being retried. With no
	// failures and nothing applied there is nothing to move it.
	let candidate = lastSyncUid;
	if (backfillApplied.length > 0) {
		candidate = Math.min(...backfillApplied);
	} else if (backfillFailures.length > 0) {
		candidate = backfillFloor;
	}

	const nextLastSyncUid = isFreshSync
		? candidate
		: Math.min(lastSyncUid, candidate);

	return {
		lastSyncUid: nextLastSyncUid,
		highWaterMarkUid: nextHighWaterMark,
	};
};
