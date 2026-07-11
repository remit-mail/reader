/**
 * Pure matching logic for the UIDVALIDITY cursor rebuild (issue #1272).
 *
 * Message identity is the Message-ID header; UIDs are cursor positions on
 * the server's axis. When UIDVALIDITY changes, the axis is gone but the
 * data isn't — this reconciles a fresh envelope-level snapshot (UID +
 * Message-ID + INTERNALDATE, no body fetch) against the rows already stored
 * for the mailbox, by identity rather than by position.
 */

/** One server message from the cheap envelope-only rebuild FETCH. */
export interface CursorRebuildSnapshot {
	uid: number;
	/** Raw RFC 822 Message-ID header; empty string when absent/unparseable. */
	messageId: string;
	/** INTERNALDATE in epoch milliseconds. */
	internalDate: number;
}

/**
 * ThreadMessage identity + every composite-key attribute ElectroDB needs to
 * run a conditional update against the row (see `buildThreadMessageMoveUpdate`
 * in `message-move.ts` for the same pattern on a normal move). Carried
 * alongside a {@link CursorRebuildRow} purely so a match can rewrite
 * ThreadMessage.uid together with Message.uid — matching itself never reads
 * these fields.
 */
export interface CursorRebuildThreadMessageRef {
	accountConfigId: string;
	threadMessageId: string;
	sentDate: number;
	mailboxId: string;
	isRead: boolean;
	isDeleted: boolean;
	hasStars: boolean;
	hasAttachment: boolean;
}

/** One existing row for the mailbox, as needed to match it against a snapshot. */
export interface CursorRebuildRow {
	/** Our internal messageId (the Message row's primary key). */
	messageId: string;
	/** Raw RFC 822 Message-ID header the row was created with. */
	messageIdHeader: string;
	/** INTERNALDATE in epoch milliseconds. */
	internalDate: number;
	/** The row's currently-stored UID (on the old, invalid axis). */
	uid: number;
	/** Present when the caller wants a match to also rewrite ThreadMessage.uid. */
	threadMessage?: CursorRebuildThreadMessageRef;
}

export interface CursorRebuildMatch {
	messageId: string;
	oldUid: number;
	newUid: number;
	/** Carried through from the matched row so the caller can rewrite
	 * ThreadMessage.uid alongside Message.uid without a second lookup. */
	threadMessage?: CursorRebuildThreadMessageRef;
}

export interface CursorRebuildMatchResult {
	/** Rows whose Message-ID matched a server message under a different UID — rewrite in place. */
	matched: CursorRebuildMatch[];
	/** Server UIDs with no matching row — run through normal new-message sync. */
	newUids: number[];
	/** Rows with no matching server message — expunged; reconcile (#1283). */
	staleMessageIds: string[];
}

const pickClosestByInternalDate = (
	snapshot: CursorRebuildSnapshot,
	candidates: CursorRebuildRow[],
	consumed: Set<string>,
): CursorRebuildRow | undefined => {
	const available = candidates.filter((row) => !consumed.has(row.messageId));
	if (available.length === 0) return undefined;
	if (available.length === 1) return available[0];
	return available.reduce((best, row) =>
		Math.abs(row.internalDate - snapshot.internalDate) <
		Math.abs(best.internalDate - snapshot.internalDate)
			? row
			: best,
	);
};

/**
 * Match a fresh server snapshot against the mailbox's existing rows by
 * Message-ID, falling back to an exact INTERNALDATE match for the (rare)
 * messages with no usable Message-ID header on either side — mirrors the
 * same headerless fallback `message-sync.ts` already uses for threading.
 *
 * Pure and side-effect free: the caller is responsible for acting on the
 * three outcomes (rewrite / new-message sync / reconcile).
 */
export const matchCursorRebuild = (
	serverSnapshots: CursorRebuildSnapshot[],
	existingRows: CursorRebuildRow[],
): CursorRebuildMatchResult => {
	const rowsByHeader = new Map<string, CursorRebuildRow[]>();
	const rowsByInternalDateOnly = new Map<number, CursorRebuildRow[]>();

	for (const row of existingRows) {
		if (row.messageIdHeader) {
			const list = rowsByHeader.get(row.messageIdHeader) ?? [];
			list.push(row);
			rowsByHeader.set(row.messageIdHeader, list);
		} else {
			const list = rowsByInternalDateOnly.get(row.internalDate) ?? [];
			list.push(row);
			rowsByInternalDateOnly.set(row.internalDate, list);
		}
	}

	const consumed = new Set<string>();
	const matched: CursorRebuildMatch[] = [];
	const newUids: number[] = [];

	for (const snapshot of serverSnapshots) {
		const candidates = snapshot.messageId
			? (rowsByHeader.get(snapshot.messageId) ?? [])
			: (rowsByInternalDateOnly.get(snapshot.internalDate) ?? []);
		const row = pickClosestByInternalDate(snapshot, candidates, consumed);

		if (!row) {
			newUids.push(snapshot.uid);
			continue;
		}

		consumed.add(row.messageId);
		if (row.uid !== snapshot.uid) {
			matched.push({
				messageId: row.messageId,
				oldUid: row.uid,
				newUid: snapshot.uid,
				...(row.threadMessage ? { threadMessage: row.threadMessage } : {}),
			});
		}
	}

	const staleMessageIds = existingRows
		.filter((row) => !consumed.has(row.messageId))
		.map((row) => row.messageId);

	return { matched, newUids, staleMessageIds };
};
