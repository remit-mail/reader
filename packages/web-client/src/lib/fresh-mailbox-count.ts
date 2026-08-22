import { abortableDelay } from "./mailbox-sync-wait";

/**
 * How many messages a folder holds *on the mail server*, rather than how many
 * the last sync round left in the local row.
 *
 * Every count the client can read — the mailbox row's `messageCount`, and so
 * the folder list and the sync-status projection over it — is whatever the last
 * round wrote. Mail that arrived since is invisible in it, which is fine for a
 * badge and fatal for a delete: `deleteMailbox` takes the folder's mail with it
 * and IMAP has no undo.
 *
 * So the count is taken from a round asked for on the spot: trigger a sync,
 * then wait for the folder's `lastSyncedAt` to advance past the stamp read
 * before the trigger, and read the count that round wrote alongside it (every
 * message-sync round writes both from the same IMAP STATUS).
 *
 * What the advancing stamp proves is that *some* round's write landed after the
 * baseline read — not necessarily the round this triggered. A round already in
 * flight can land first and satisfy the wait. That is accepted: its STATUS was
 * taken within milliseconds of the baseline, and the error it can carry is a
 * count from a moment too early, which either agrees with the trigger's round
 * or reports mail the folder had and the delete then refuses. The mistake lands
 * on the side of not deleting.
 *
 * Nothing here decides on a count read before the trigger, and every way out
 * other than an advanced stamp throws or reports `pending`: a folder missing
 * from the account, a failed read, an aborted wait. Uncertainty about what a
 * folder holds is never permission to delete it.
 */

/** The read fields the wait needs off a sync-status entry. */
export interface MailboxCountReading {
	mailboxId: string;
	messagesTotal: number;
	lastSyncedAt?: number;
}

/** A count from a round that reported after the baseline, or no round yet. */
export type FreshCountOutcome =
	| { status: "fresh"; messageCount: number }
	| { status: "pending" };

export interface AwaitFreshMailboxCountOptions {
	/** Reads every mailbox's sync-status entry; called once per poll. */
	readMailboxes: () => Promise<readonly MailboxCountReading[]>;
	/** The folder to count. */
	mailboxId: string;
	/** The folder's `lastSyncedAt` as read before the sync was triggered. */
	since: number;
	/** Aborts the wait; a round that lands afterwards resolves nothing. */
	signal?: AbortSignal;
	/** How long this stretch of waiting runs before reporting `pending`. */
	segmentMs?: number;
	pollIntervalMs?: number;
	/** Injectable clock/sleep for tests. */
	delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
	now?: () => number;
}

/**
 * How long one stretch of waiting runs before handing the decision back to the
 * user. An explicit sync fans the whole account out on one FIFO group with
 * INBOX first, so a folder on a large account can sit behind minutes of other
 * mailboxes: this is not long enough to conclude anything, only long enough
 * that someone watching a spinner deserves to be asked whether to keep waiting.
 */
export const FRESH_COUNT_SEGMENT_MS = 120_000;
export const FRESH_COUNT_POLL_INTERVAL_MS = 2_000;

export const FRESH_COUNT_MISSING_MESSAGE =
	"This folder is no longer in the account's folder list, so nothing was deleted.";

const entryFor = (
	mailboxes: readonly MailboxCountReading[],
	mailboxId: string,
): MailboxCountReading => {
	const entry = mailboxes.find((mailbox) => mailbox.mailboxId === mailboxId);
	if (!entry) throw new Error(FRESH_COUNT_MISSING_MESSAGE);
	return entry;
};

/** The folder's last sync stamp, or a refusal when the account does not list it. */
export const mailboxSyncStamp = (
	mailboxes: readonly MailboxCountReading[],
	mailboxId: string,
): number => entryFor(mailboxes, mailboxId).lastSyncedAt ?? 0;

/**
 * Poll for one segment. Resolves `fresh` with the count once a round reports
 * past `since`, `pending` when the segment runs out with the folder still
 * unreported — the caller asks the user whether to wait on, and calling again
 * with the same `since` resumes without triggering a second round.
 */
export async function awaitFreshMailboxCount({
	readMailboxes,
	mailboxId,
	since,
	signal,
	segmentMs = FRESH_COUNT_SEGMENT_MS,
	pollIntervalMs = FRESH_COUNT_POLL_INTERVAL_MS,
	delay = abortableDelay,
	now = Date.now,
}: AwaitFreshMailboxCountOptions): Promise<FreshCountOutcome> {
	const deadline = now() + segmentMs;
	for (;;) {
		signal?.throwIfAborted();
		const entry = entryFor(await readMailboxes(), mailboxId);
		if ((entry.lastSyncedAt ?? 0) > since)
			return { status: "fresh", messageCount: entry.messagesTotal };
		if (now() >= deadline) return { status: "pending" };
		await delay(pollIntervalMs, signal);
	}
}
