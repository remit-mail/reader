import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";

const isNotFoundError = (error: unknown): boolean =>
	error instanceof Error && error.name === "NotFoundError";

/**
 * Whether the IMAP server is not known to hold this folder — the row is gone,
 * its creation has not reached the server yet, or its deletion has been asked
 * for and not finished. Folders are written locally first and reconciled to the
 * server by the worker, so both ends of that lifecycle are states in which
 * syncing the folder can only fail.
 *
 * This is the terminal test for a sync event whose folder is not there. The
 * row's absence alone does not decide it, at either end: on the way out the row
 * is removed only after the IMAP folder is, so an event that fails against the
 * server still sees a live row for as long as that write takes; on the way in
 * the row exists before the folder does. `pending` and `deleting` are written by
 * the request itself, before the event that resolves it is enqueued, which is
 * what makes them sound proxies for presence: neither can be observed unless a
 * create has yet to land or a delete has been asked for.
 *
 * `failed` is deliberately not one of them, though it is the fourth state a
 * mailbox row can carry. It records that the last management operation failed
 * and says nothing about whether the folder is on the server: `handleDelete` and
 * `handleRename` set it on folders that exist and hold the user's mail, and
 * nothing ever clears it — `syncStatus` returns to `synced` only from a
 * subsequent successful create or rename, never from the sweep. Treating it as
 * off-server would stop syncing such a folder permanently and silently, which is
 * worse than the bounded stall it would remove. A `failed` row whose folder is
 * genuinely absent is reaped by the sweep's own cleanup, which runs before the
 * fan-out that would enqueue work for it.
 *
 * Mailbox management is judged differently — it is what establishes and removes
 * the folder, so it terminates on a not-found row alone.
 */
export const isFolderOffServer = (
	mailbox: Pick<MailboxItem, "syncStatus">,
): boolean =>
	mailbox.syncStatus === MailboxSyncStatus.pending ||
	mailbox.syncStatus === MailboxSyncStatus.deleting;

/** {@link isFolderOffServer} for a mailbox that has to be read first, an absent row included. */
export const isMailboxNotOnServer = async (
	mailboxService: Pick<IMailboxRepository, "get">,
	accountId: string,
	mailboxId: string,
): Promise<boolean> => {
	const mailbox = await mailboxService
		.get(accountId, mailboxId)
		.catch((error: unknown) => {
			if (isNotFoundError(error)) return undefined;
			throw error;
		});
	if (!mailbox) return true;
	return isFolderOffServer(mailbox);
};
