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
 * Adjusts `messageCount` on a set of mailboxes to reflect every pending
 * placement move (epic #1281 invariant 4): a prediction applied at READ
 * TIME, never written back to storage. `Mailbox.messageCount` is refreshed
 * only by mailbox-sync re-reading IMAP — a pending move has already relocated
 * the message locally (`ThreadMessage.mailboxId`), so its destination folder's
 * live listing outnumbers the stored counter by one until the marker
 * confirms and a resync catches up. Without this, the folder list and its
 * own message-count badge visibly disagree for however long the move is
 * pending.
 *
 * Deliberately does NOT touch `unseenCount` — the marker does not carry
 * read/unread state, so any adjustment there would be a guess, not a
 * prediction derived from a known fact.
 *
 * Pure: takes the mailboxes and the pending moves as plain input, returns a
 * new array. Never mutates its arguments.
 */
export const applyPendingMoveCountPrediction = (
	mailboxes: readonly MailboxItem[],
	pendingMoves: readonly PendingPlacementMove[],
): MailboxItem[] => {
	if (pendingMoves.length === 0) return [...mailboxes];

	const delta = new Map<string, number>();
	for (const move of pendingMoves) {
		if (move.sourceMailboxId === move.destinationMailboxId) continue;
		delta.set(move.sourceMailboxId, (delta.get(move.sourceMailboxId) ?? 0) - 1);
		delta.set(
			move.destinationMailboxId,
			(delta.get(move.destinationMailboxId) ?? 0) + 1,
		);
	}

	return mailboxes.map((mailbox) => {
		const adjustment = delta.get(mailbox.mailboxId);
		if (!adjustment) return mailbox;
		return {
			...mailbox,
			messageCount: Math.max(0, mailbox.messageCount + adjustment),
		};
	});
};
