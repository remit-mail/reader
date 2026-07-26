import { MailboxSyncStatus } from "@remit/domain-enums";

type MailboxSyncStatusValue =
	(typeof MailboxSyncStatus)[keyof typeof MailboxSyncStatus];

/**
 * A folder created for a dependent write — a filter that will move mail into it,
 * or a move that lands mail there — is not usable the instant the create is
 * queued: the row exists locally with `syncStatus: pending`, and the folder does
 * not exist on the mail server until the imap-worker confirms the create and
 * flips it to `synced`. Binding the dependent write to a `pending` row races the
 * folder into existence across separate FIFO queues and cannot report a create
 * that fails. This waits for the confirmation before the dependent write runs.
 *
 * The standalone create (a folder made in settings with no dependent write) does
 * not use this — it may stay optimistic. The wait is only for the dependent case.
 */

/** The read fields the wait needs off a mailbox row. */
export interface MailboxSyncSignal {
	mailboxId: string;
	syncStatus?: MailboxSyncStatusValue;
}

export interface WaitForMailboxSyncedOptions<T extends MailboxSyncSignal> {
	/** Reads the current mailbox rows; called once per poll (forces a fresh read). */
	fetchMailboxes: () => Promise<readonly T[]>;
	/** The row to wait on. */
	mailboxId: string;
	/** How long to wait for confirmation before giving up. */
	timeoutMs?: number;
	/** Gap between polls. */
	pollIntervalMs?: number;
	/** Injectable clock/sleep for tests. */
	delay?: (ms: number) => Promise<void>;
	now?: () => number;
}

export const MAILBOX_SYNC_TIMEOUT_MS = 30_000;
export const MAILBOX_SYNC_POLL_INTERVAL_MS = 1_000;

export const MAILBOX_SYNC_FAILED_MESSAGE =
	"The folder couldn't be created on the mail server. Please try again.";
export const MAILBOX_SYNC_TIMEOUT_MESSAGE =
	"Creating the folder is taking longer than expected. Please try again.";

const defaultDelay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve with the mailbox row once its `syncStatus` reaches `synced` — the
 * server-confirmed row, carrying the path the server normalized the create to.
 * Reject with a failure message when the create is reported `failed`, and with a
 * distinct timeout message when it never confirms within `timeoutMs`. A row that
 * is still `pending` (or not yet in the list) keeps the poll running.
 */
export async function waitForMailboxSynced<T extends MailboxSyncSignal>({
	fetchMailboxes,
	mailboxId,
	timeoutMs = MAILBOX_SYNC_TIMEOUT_MS,
	pollIntervalMs = MAILBOX_SYNC_POLL_INTERVAL_MS,
	delay = defaultDelay,
	now = Date.now,
}: WaitForMailboxSyncedOptions<T>): Promise<T> {
	const deadline = now() + timeoutMs;
	for (;;) {
		const mailboxes = await fetchMailboxes();
		const mailbox = mailboxes.find((entry) => entry.mailboxId === mailboxId);
		if (mailbox?.syncStatus === MailboxSyncStatus.synced) return mailbox;
		if (mailbox?.syncStatus === MailboxSyncStatus.failed)
			throw new Error(MAILBOX_SYNC_FAILED_MESSAGE);
		if (now() >= deadline) throw new Error(MAILBOX_SYNC_TIMEOUT_MESSAGE);
		await delay(pollIntervalMs);
	}
}
