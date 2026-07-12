import type { MailboxItem } from "@remit/remit-electrodb-service";

/**
 * The subset of a pending placement-move marker (issue #1271) this
 * derivation needs — decoupled from the concrete marker type so it stays a
 * pure function over plain data.
 */
export interface PendingPlacementMove {
	sourceMailboxId: string;
	destinationMailboxId: string;
}

/**
 * The subset of a pending flag-push marker (issue #1273) this derivation
 * needs. Only `\Seen` markers are meaningful here — `mailboxId` is the
 * marker's denormalized "last-known" mailbox, the same read-time-only hint
 * `applyPendingMoveCountPrediction` already tolerates for placement moves.
 */
export interface PendingUnseenFlagPush {
	mailboxId: string;
	operation: "add" | "remove";
}

/**
 * Adjusts `messageCount` and `unseenCount` on a set of mailboxes to reflect
 * every pending placement move (issue #1271) and pending `\Seen` flag push
 * (issue #1273): a prediction applied at READ TIME, never written back to
 * storage (epic #1281 invariant 4). Stored counts are refreshed only by
 * mailbox-sync re-reading IMAP.
 *
 * - A pending move has already relocated the message locally
 *   (`ThreadMessage.mailboxId`), so its destination folder's live listing
 *   outnumbers the stored `messageCount` by one until the marker confirms
 *   and a resync catches up.
 * - A pending `\Seen` push has already flipped `ThreadMessage.isRead`
 *   locally: `add` (marked read) means the stored `unseenCount` is one HIGH
 *   until the push confirms; `remove` (marked unread) means it is one LOW.
 *   Only `\Seen` markers carry read/unread state — a pending `\Flagged`
 *   (star) marker never adjusts either count, same reasoning the placement
 *   move prediction already applies to its own scope.
 *
 * Pure: takes the mailboxes and the pending markers as plain input, returns a
 * new array. Never mutates its arguments.
 */
export const applyPendingMoveCountPrediction = (
	mailboxes: readonly MailboxItem[],
	pendingMoves: readonly PendingPlacementMove[],
	pendingUnseenFlagPushes: readonly PendingUnseenFlagPush[] = [],
): MailboxItem[] => {
	if (pendingMoves.length === 0 && pendingUnseenFlagPushes.length === 0) {
		return [...mailboxes];
	}

	const messageCountDelta = new Map<string, number>();
	for (const move of pendingMoves) {
		if (move.sourceMailboxId === move.destinationMailboxId) continue;
		messageCountDelta.set(
			move.sourceMailboxId,
			(messageCountDelta.get(move.sourceMailboxId) ?? 0) - 1,
		);
		messageCountDelta.set(
			move.destinationMailboxId,
			(messageCountDelta.get(move.destinationMailboxId) ?? 0) + 1,
		);
	}

	const unseenCountDelta = new Map<string, number>();
	for (const push of pendingUnseenFlagPushes) {
		const adjustment = push.operation === "add" ? -1 : 1;
		unseenCountDelta.set(
			push.mailboxId,
			(unseenCountDelta.get(push.mailboxId) ?? 0) + adjustment,
		);
	}

	return mailboxes.map((mailbox) => {
		const messageAdjustment = messageCountDelta.get(mailbox.mailboxId);
		const unseenAdjustment = unseenCountDelta.get(mailbox.mailboxId);
		if (!messageAdjustment && !unseenAdjustment) return mailbox;
		return {
			...mailbox,
			messageCount: messageAdjustment
				? Math.max(0, mailbox.messageCount + messageAdjustment)
				: mailbox.messageCount,
			unseenCount: unseenAdjustment
				? Math.max(0, mailbox.unseenCount + unseenAdjustment)
				: mailbox.unseenCount,
		};
	});
};
