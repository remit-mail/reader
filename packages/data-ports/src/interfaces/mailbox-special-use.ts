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
	findArchiveMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null>;
	findJunkMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null>;
}
