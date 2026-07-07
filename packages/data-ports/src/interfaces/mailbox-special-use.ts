import type {
	MailboxSpecialUseItem,
	MailboxSpecialUseValue,
} from "../types.js";

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
	findBySpecialUse(
		accountId: string,
		specialUse: MailboxSpecialUseValue,
	): Promise<{ mailboxId: string; fullPath: string } | null>;
	findInboxMailbox(
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
