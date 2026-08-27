import type { IMailboxSpecialUseRepository } from "@remit/data-ports";
import type {
	JunkRoleMailboxes,
	RoleResolution,
} from "@remit/data-ports/folder-role";

type RoleMailbox = { mailboxId: string; fullPath: string };

/**
 * The evidence-carrying answer behind `findTrashMailbox`, so a stub that names
 * a Trash folder answers both reads consistently. A named folder stands in as
 * server-flagged: the suites using this are testing something other than how
 * the role was decided.
 */
export const trashRole = (
	trash: RoleMailbox | null,
): RoleResolution<RoleMailbox> =>
	trash ? { kind: "flagged", mailbox: trash } : { kind: "none" };

/**
 * A folder-role map for an account that has appointed nothing and whose server
 * flags nothing — every mailbox is an ordinary folder. The stand-in for the
 * many suites that construct `MessageSyncService` for a reason unrelated to
 * which folder holds which role.
 */
export const noFolderRoles = {
	findJunkMailbox: async () => null,
	findTrashMailbox: async () => null,
	resolveTrashRole: async () => trashRole(null),
	resolveJunkRolesForConfig: async () => NO_JUNK_ROLES,
} as unknown as IMailboxSpecialUseRepository;

/** A folder-role map naming the mailboxes that hold Junk and Trash. */
export const folderRoles = (roles: {
	junkMailboxId?: string;
	trashMailboxId?: string;
}): IMailboxSpecialUseRepository => {
	const trash = roles.trashMailboxId
		? { mailboxId: roles.trashMailboxId, fullPath: roles.trashMailboxId }
		: null;
	return {
		findJunkMailbox: async () =>
			roles.junkMailboxId
				? { mailboxId: roles.junkMailboxId, fullPath: roles.junkMailboxId }
				: null,
		findTrashMailbox: async () => trash,
		resolveTrashRole: async () => trashRole(trash),
		resolveJunkRolesForConfig: async () => ({
			junkMailboxIds: roles.junkMailboxId ? [roles.junkMailboxId] : [],
			trashMailboxIds: roles.trashMailboxId ? [roles.trashMailboxId] : [],
		}),
	} as unknown as IMailboxSpecialUseRepository;
};

/** An account whose config resolves no Junk and no Trash anywhere. */
export const NO_JUNK_ROLES: JunkRoleMailboxes = {
	junkMailboxIds: [],
	trashMailboxIds: [],
};

/** The same account, as the resolved map `saveMessage` is handed. */
export const NO_FOLDER_ROLES = {
	junkMailboxId: null,
	trashMailboxId: null,
	configJunkRoles: NO_JUNK_ROLES,
};
