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
 *
 * Anything that is not plain digits reads as no mod-sequence rather than
 * throwing. A cursor is read at the very top of a sync round, so a value this
 * cannot parse would take the mailbox out of sync permanently, and leave no
 * path to repair it — every route to the field runs through here. Degrading to
 * 0 sends the mailbox back to enumeration, which reseeds it.
 */
const DECIMAL_DIGITS = /^\d+$/;

export const parseModseq = (raw: string | undefined): bigint => {
	if (!raw || !DECIMAL_DIGITS.test(raw)) return 0n;
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
 * The message-sync cursor: how far CHANGEDSINCE has been applied.
 *
 * `modseq` is what the next fetch asks from. `group` and `uid` describe a
 * mod-sequence a previous round left part-applied: which one, and how far into
 * it the round got. `group` is 0 when the cursor sits on a clean boundary.
 *
 * The sub-position exists because one STORE assigns the SAME mod-sequence to
 * every message it touched (RFC 7162 permits it and servers do it), so "select
 * all, mark read" arrives as one group of arbitrary size. CHANGEDSINCE is
 * strictly greater-than, so a cursor that advanced to a partly-applied group
 * would never see its tail again; a cursor that refused to split it would have
 * to apply the whole group in one round, which for a large mailbox does not
 * finish, and every retry would repeat the same unfinished work. The
 * sub-position is what lets one group span rounds without ever claiming more
 * than was applied.
 *
 * The group is recorded rather than inferred from the fetch result. The
 * in-progress group is NOT reliably the lowest mod-sequence returned: its
 * remaining members can disappear between rounds, by being expunged (which
 * CONDSTORE simply stops reporting) or by being modified again onto a higher
 * mod-sequence. Inferring it then points the skip at an unrelated group and
 * silently drops that group's leading messages.
 */
export interface ChangeCursor {
	/** Fetch from here — everything above it is still owed. */
	modseq: bigint;
	/** The mod-sequence left part-applied, or 0 on a clean boundary. */
	group: bigint;
	/** Highest UID applied within `group`. */
	uid: number;
}

/**
 * Read a stored cursor.
 *
 * Two forms: `"<modseq>"` is a clean boundary — every value written before the
 * sub-position existed, which is what they always meant. `"<group>:<uid>"` is a
 * position inside a group; the fetch point is implied, because a round only
 * ever stops inside a group once everything below it has been applied.
 *
 * Storing the implied fetch point instead of a third number is what keeps the
 * value inside the field's 32 characters: two 64-bit mod-sequences and a UID
 * would not fit.
 */
export const parseChangeCursor = (raw: string | undefined): ChangeCursor => {
	const [left, right] = (raw ?? "").split(":");

	if (right === undefined) {
		return { modseq: parseModseq(left), group: 0n, uid: 0 };
	}

	const group = parseModseq(left);
	const uid = DECIMAL_DIGITS.test(right) ? Number.parseInt(right, 10) : 0;
	if (group === 0n || uid === 0) {
		return { modseq: group, group: 0n, uid: 0 };
	}

	return { modseq: group - 1n, group, uid };
};

/** Render a cursor. A clean boundary stays plain digits. */
export const formatChangeCursor = (cursor: ChangeCursor): string =>
	cursor.group > 0n && cursor.uid > 0
		? `${cursor.group.toString()}:${cursor.uid}`
		: cursor.modseq.toString();

/** True when the cursor is far enough along to fetch incrementally at all. */
export const hasChangeCursor = (cursor: ChangeCursor): boolean =>
	cursor.modseq > 0n || cursor.group > 0n;

/**
 * Drop the part of a part-applied group that a previous round already applied.
 *
 * The fetch asks from below the in-progress group, so a resumed round is served
 * that group again in full. Its applied members are recognised by position
 * alone — the fetch row carries both its mod-sequence and its UID — so skipping
 * them costs no lookup. Rows of any other mod-sequence are never skipped, which
 * is what makes a vanished remainder harmless instead of lossy.
 */
export const dropAppliedPrefix = (
	ordered: ImapMessage[],
	cursor: ChangeCursor,
): ImapMessage[] => {
	if (cursor.group === 0n || cursor.uid === 0) return ordered;
	return ordered.filter(
		(message) =>
			parseModseq(message.modseq) !== cursor.group || message.uid > cursor.uid,
	);
};

export interface ChangeCursorAdvanceInput {
	/** The cursor this round started from. */
	cursor: ChangeCursor;
	/** HIGHESTMODSEQ the server reported before this round fetched anything. */
	serverModseq: bigint;
	/** The changed set still to apply, in {@link orderByModseq} order. */
	ordered: ImapMessage[];
	/** The prefix of `ordered` this round processed. */
	batch: ImapMessage[];
	/** UIDs whose save threw and must be re-applied. */
	failedUids: ReadonlySet<number>;
}

export interface ChangeCursorAdvance {
	cursor: ChangeCursor;
	/** True when changes remain that this round did not process. */
	hasMore: boolean;
}

/**
 * Decide how far the cursor may move after a round.
 *
 * It moves over the leading run of applied messages and stops at the first one
 * that was not — a failure, or simply the end of the batch. Everything after
 * that point is treated as unapplied even if it succeeded, which costs an
 * idempotent re-apply next round and buys a cursor that can never claim more
 * than it did.
 *
 * Where it stops decides the shape: on a group boundary the cursor is that
 * group's mod-sequence with no sub-position; inside a group it keeps the last
 * complete mod-sequence and records how far into the next one it got.
 *
 * A round that consumed everything without a failure jumps to the server's
 * HIGHESTMODSEQ rather than the last message's mod-sequence. Those are not the
 * same number: a mod-sequence also moves for events that return no message (an
 * expunge, a change to a message the fetch filtered out), and stopping short
 * would re-deliver them on every subsequent round. That value is read before
 * the fetch, so anything changing while the round runs lands above it and
 * arrives next time.
 */
export const advanceChangeCursor = ({
	cursor,
	serverModseq,
	ordered,
	batch,
	failedUids,
}: ChangeCursorAdvanceInput): ChangeCursorAdvance => {
	const applied: ImapMessage[] = [];
	for (const message of batch) {
		if (failedUids.has(message.uid)) break;
		applied.push(message);
	}

	const hasMore = ordered.length > batch.length;
	const next = ordered[applied.length];

	if (applied.length === 0) {
		return { cursor, hasMore };
	}

	const last = applied[applied.length - 1];
	const lastModseq = parseModseq(last.modseq);

	if (next === undefined) {
		return {
			cursor: {
				modseq: serverModseq > lastModseq ? serverModseq : lastModseq,
				group: 0n,
				uid: 0,
			},
			hasMore,
		};
	}

	const nextModseq = parseModseq(next.modseq);
	if (nextModseq > lastModseq) {
		return { cursor: { modseq: lastModseq, group: 0n, uid: 0 }, hasMore };
	}

	// Stopped inside a group. Everything below it was applied — the round works
	// through `ordered` in order — so the fetch point is the value just below
	// the group, and the group itself is recorded so the resumed round skips by
	// identity rather than by guessing which group it is looking at.
	//
	// "Everything below it was applied" holds because `ordered` is the COMPLETE
	// set of unapplied changes: the fetch is CHANGEDSINCE over `1:*`. Narrowing
	// that fetch by UID range would leave changes below the group unapplied and
	// unrepresented here, and this cursor would then step over them.
	//
	// The floor matters when a server returns a message with no MODSEQ at all:
	// `nextModseq` is then 0 and the cursor must not go negative.
	const fetchFrom = nextModseq > 0n ? nextModseq - 1n : 0n;
	return {
		cursor: { modseq: fetchFrom, group: nextModseq, uid: last.uid },
		hasMore,
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
