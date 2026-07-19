import type { MailboxItem } from "@remit/data-ports";

/** The subset of mailbox fields needed to derive sync progress. */
export type MailboxSyncFields = Pick<
	MailboxItem,
	| "lastMessageSyncAt"
	| "initialSyncCompletedAt"
	| "messageCount"
	| "lastSyncUid"
	| "highWaterMarkUid"
>;

/**
 * Derive a per-mailbox sync phase from worker-written sync state.
 *
 * - pending:  never synced (lastMessageSyncAt is 0 / unset)
 * - complete: the imap-worker drained the mailbox and stamped
 *             initialSyncCompletedAt after the last batch write
 *             (initialSyncCompletedAt >= lastMessageSyncAt), or the
 *             mailbox is empty
 * - syncing:  sync has started but is not yet complete
 *
 * Note: UID watermarks alone cannot express completion — backfill settles
 * at the mailbox's smallest real UID (UIDs are sparse), so the completion
 * marker written by the worker is the source of truth.
 */
export const deriveMailboxPhase = (mailbox: MailboxSyncFields): string => {
	if (!mailbox.lastMessageSyncAt) return "pending";
	const messageCount = mailbox.messageCount ?? 0;
	const initialSyncCompletedAt = mailbox.initialSyncCompletedAt ?? 0;

	// Completion marker is fresh: no batch was written after the worker
	// recorded the mailbox as drained.
	if (
		initialSyncCompletedAt > 0 &&
		initialSyncCompletedAt >= mailbox.lastMessageSyncAt
	) {
		return "complete";
	}

	// Also complete if messageCount is 0 (empty mailbox)
	if (messageCount === 0) return "complete";

	return "syncing";
};

/**
 * Compute approximate messagesSynced from UID watermarks.
 *
 * UIDs are sparse (not necessarily contiguous), so this is an approximation.
 * We clamp the result to [0, messagesTotal].
 */
export const computeMessagesSynced = (mailbox: MailboxSyncFields): number => {
	const messagesTotal = mailbox.messageCount ?? 0;
	const lastSyncUid = mailbox.lastSyncUid ?? 0;
	const highWaterMarkUid = mailbox.highWaterMarkUid ?? 0;

	if (highWaterMarkUid === 0) return 0;

	// UID range approximation: number of UIDs in the synced range
	const synced = highWaterMarkUid - lastSyncUid + 1;

	return Math.min(Math.max(synced, 0), messagesTotal);
};
