import type { IMailboxSpecialUseRepository } from "@remit/data-ports";

/**
 * A folder-role map for an account that has appointed nothing and whose server
 * flags nothing — every mailbox is an ordinary folder. The stand-in for the
 * many suites that construct `MessageSyncService` for a reason unrelated to
 * which folder holds which role.
 */
export const noFolderRoles = {
	findJunkMailbox: async () => null,
	findTrashMailbox: async () => null,
} as unknown as IMailboxSpecialUseRepository;

/** A folder-role map naming the mailboxes that hold Junk and Trash. */
export const folderRoles = (roles: {
	junkMailboxId?: string;
	trashMailboxId?: string;
}): IMailboxSpecialUseRepository =>
	({
		findJunkMailbox: async () =>
			roles.junkMailboxId
				? { mailboxId: roles.junkMailboxId, fullPath: roles.junkMailboxId }
				: null,
		findTrashMailbox: async () =>
			roles.trashMailboxId
				? { mailboxId: roles.trashMailboxId, fullPath: roles.trashMailboxId }
				: null,
	}) as unknown as IMailboxSpecialUseRepository;

/** The same account, as the resolved map `saveMessage` is handed. */
export const NO_FOLDER_ROLES = {
	junkMailboxId: null,
	trashMailboxId: null,
};
