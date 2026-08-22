import { abortableDelay } from "./mailbox-sync-wait";

/**
 * How many messages a folder holds *on the mail server right now*.
 *
 * Every count the client can read locally — the mailbox row's `messageCount`,
 * and so the folder list and the sync-status projection over it — is whatever
 * the last sync round wrote. Mail that arrived since is invisible in it, which
 * is fine for a badge and fatal for a delete: `deleteMailbox` takes the folder's
 * mail with it and IMAP has no undo.
 *
 * So this asks the server rather than the cache: trigger a sync round, wait for
 * evidence that the round actually ran against this folder — its `lastSyncedAt`
 * advancing past the stamp taken before the trigger — and only then read the
 * count the round wrote. Nothing here decides anything on a count that predates
 * the trigger.
 *
 * The wait is bounded and every way out other than a confirmed round throws:
 * a folder missing from the account, a round that never lands inside
 * `timeoutMs`, a failed read, an aborted wait. Uncertainty about what a folder
 * holds is never permission to delete it.
 */

/** The read fields the wait needs off a sync-status entry. */
export interface MailboxCountReading {
	mailboxId: string;
	messagesTotal: number;
	lastSyncedAt?: number;
}

export interface WaitForFreshMailboxCountOptions {
	/** Reads every mailbox's sync-status entry; called once per poll. */
	readMailboxes: () => Promise<readonly MailboxCountReading[]>;
	/** Asks the server for a sync round; resolves on the enqueue ack. */
	triggerSync: () => Promise<void>;
	/** The folder to count. */
	mailboxId: string;
	/** Aborts the wait; a round that lands afterwards resolves nothing. */
	signal?: AbortSignal;
	timeoutMs?: number;
	pollIntervalMs?: number;
	/** Injectable clock/sleep for tests. */
	delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
	now?: () => number;
}

export const FRESH_COUNT_TIMEOUT_MS = 45_000;
export const FRESH_COUNT_POLL_INTERVAL_MS = 2_000;

export const FRESH_COUNT_TIMEOUT_MESSAGE =
	"The mail server hasn't reported back on this folder yet, so nothing was deleted. Try again in a moment.";
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

/** Resolve with the message count a sync round read off the server after it was asked for. */
export async function waitForFreshMailboxCount({
	readMailboxes,
	triggerSync,
	mailboxId,
	signal,
	timeoutMs = FRESH_COUNT_TIMEOUT_MS,
	pollIntervalMs = FRESH_COUNT_POLL_INTERVAL_MS,
	delay = abortableDelay,
	now = Date.now,
}: WaitForFreshMailboxCountOptions): Promise<number> {
	signal?.throwIfAborted();
	const before = entryFor(await readMailboxes(), mailboxId).lastSyncedAt ?? 0;
	signal?.throwIfAborted();
	await triggerSync();

	const deadline = now() + timeoutMs;
	for (;;) {
		signal?.throwIfAborted();
		const entry = entryFor(await readMailboxes(), mailboxId);
		if ((entry.lastSyncedAt ?? 0) > before) return entry.messagesTotal;
		if (now() >= deadline) throw new Error(FRESH_COUNT_TIMEOUT_MESSAGE);
		await delay(pollIntervalMs, signal);
	}
}
