import type { RoleResolution } from "../folder-role.js";
import type {
	MailboxSpecialUseItem,
	MailboxSpecialUseValue,
} from "../types.js";

/**
 * Special-use entries, plus the per-role lookup every special-folder operation
 * goes through. The `find<Role>Mailbox` reads answer "which folder holds this
 * role for this account", in the one precedence order `resolveMailboxForRole`
 * defines: the user's appointment first (RFC 032 exclusive-folder-appointment,
 * #976), then the server's SPECIAL-USE flag, then a conventional name.
 */
export interface IMailboxSpecialUseRepository {
	create(
		mailboxId: string,
		specialUse: MailboxSpecialUseValue,
	): Promise<MailboxSpecialUseItem>;
	createMany(
		mailboxId: string,
		specialUses: MailboxSpecialUseValue[],
	): Promise<MailboxSpecialUseItem[]>;
	listByMailboxId(mailboxId: string): Promise<MailboxSpecialUseItem[]>;
	deleteByMailboxId(mailboxId: string): Promise<number>;
	findInboxMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null>;
	findSentMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null>;
	findTrashMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null>;
	/**
	 * Trash without the name guess: the appointment or the \Trash flag, nothing
	 * else. Empty Trash expunges whatever this returns, and a folder merely
	 * named `Deleted` is not consent to destroy its contents.
	 */
	findConfirmedTrashMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null>;
	/**
	 * Trash with the evidence attached, for the two verbs that weigh it: a
	 * delete files mail somewhere retrievable, an Empty Trash destroys it, and
	 * they refuse on different grounds. `null` cannot tell them apart — an
	 * appointment naming a folder that is gone is a different answer from no
	 * folder at all, and only this read distinguishes them.
	 */
	resolveTrashRole(
		accountId: string,
	): Promise<RoleResolution<{ mailboxId: string; fullPath: string }>>;
	findArchiveMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null>;
	findJunkMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null>;
}
