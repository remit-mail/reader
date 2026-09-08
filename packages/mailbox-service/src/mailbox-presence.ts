import type { IMailboxRepository, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";

export const isNotFoundError = (error: unknown): boolean =>
	error instanceof Error && error.name === "NotFoundError";

/**
 * Every state a mailbox row can carry, for a transition whose caller decided
 * against none of them.
 *
 * A transition predicate is supposed to name the state the caller read
 * (docs/architecture/folder-rename-and-delete.md D3). What still uses this one
 * is the delete path — its intent recorder and its settle are today's
 * unconditional writes, moved onto the only door that can write a folder state
 * at all, and #362 narrows each to the from-set its transition-table row
 * allows, which is also where its loser gets a 409. The rename path is already
 * narrowed: `INTENT_RECORDABLE_FROM` for the intent, and `pending` plus the
 * recorded target for the settle.
 */
export const EVERY_MAILBOX_STATE = [
	MailboxSyncStatus.synced,
	MailboxSyncStatus.pending,
	MailboxSyncStatus.failed,
	MailboxSyncStatus.deleting,
] as const;

/**
 * Whether a folder mutation is in flight, so nothing else may touch the folder
 * over IMAP.
 *
 * It used to be spelled as a presence test — is the folder off the server —
 * and that is no longer what it asks. Under D2 `fullPath` is always a path the
 * server holds, rename target and all, so a rename-pending folder *is* on the
 * server; what the two states share is that a worker owns the folder until its
 * mutation settles. `pending` and `deleting` are written by the request itself,
 * before the event that resolves it is enqueued, so neither can be observed
 * unless a create or rename has yet to land or a delete has been asked for.
 *
 * This is the terminal test for a sync event whose folder is not the sync's to
 * touch. The row's absence alone does not decide it, at either end: on the way
 * out the row is removed only after the IMAP folder is, so an event that fails
 * against the server still sees a live row for as long as that write takes; on
 * the way in the row exists before the folder does.
 *
 * `failed` is deliberately not one of them. The invariant is that a `failed`
 * row's folder exists at `fullPath` and the last rename or delete intent did
 * not land — so the folder holds the user's mail and syncing it is right.
 * D7 is what upholds that: a create the server refuses leaves no row at all,
 * rather than a `failed` one standing for a folder that was never made. Reading
 * `failed` as off-server would stop syncing a live folder permanently and
 * silently, which is worse than the bounded stall it would remove.
 *
 * A rename-pending folder is skipped even though its `fullPath` is live. That
 * is conservative rather than necessary (D12): it keeps this a single
 * expression and costs a few seconds of sync for one folder.
 *
 * Mailbox management is judged differently — it is what establishes and removes
 * the folder, so it terminates on a not-found row alone.
 */
export const isFolderMutationInFlight = (
	mailbox: Pick<MailboxItem, "syncStatus">,
): boolean =>
	mailbox.syncStatus === MailboxSyncStatus.pending ||
	mailbox.syncStatus === MailboxSyncStatus.deleting;

/** {@link isFolderMutationInFlight} for a mailbox that has to be read first, an absent row included. */
export const isMailboxMutationInFlight = async (
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
	return isFolderMutationInFlight(mailbox);
};
