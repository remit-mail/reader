import type {
	CreateMailboxInput,
	MailboxItem,
	ResultList,
	UpdateMailboxInput,
} from "../types.js";

export interface IMailboxRepository {
	create(input: CreateMailboxInput): Promise<MailboxItem>;
	get(accountId: string, mailboxId: string): Promise<MailboxItem>;
	get(accountId: string, mailboxIds: string[]): Promise<MailboxItem[]>;
	/**
	 * Resolve the owning accountId for a mailbox by its (globally unique) id,
	 * without a tenant scope. Returns only the owner id (no row content); null
	 * when the mailbox does not exist.
	 *
	 * The result is NOT a trusted tenant — it is derived from the row, so it must
	 * never be fed back as the scope of a request-facing read. It has two uses:
	 * pure system routing/indexing that has no tenant of its own (stream bridge,
	 * search indexer), and ownership bootstrap where a request-facing caller
	 * compares the resolved owner's accountConfigId against its OWN authenticated
	 * accountConfigId to decide the caller may proceed.
	 */
	resolveAccountId(mailboxId: string): Promise<string | null>;
	update(
		accountId: string,
		mailboxId: string,
		input: UpdateMailboxInput,
		remove?: string[],
	): Promise<MailboxItem>;
	delete(accountId: string, mailboxId: string): Promise<void>;
	deleteMany(accountId: string, mailboxIds: string[]): Promise<void>;
	listByAccount(
		accountId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<MailboxItem>>;
	listAllByAccount(accountId: string): Promise<MailboxItem[]>;
	findByPath(accountId: string, fullPath: string): Promise<MailboxItem | null>;
	getOrCreateByPath(
		accountId: string,
		fullPath: string,
		defaults: Omit<CreateMailboxInput, "accountId" | "fullPath">,
	): Promise<MailboxItem>;
	findByPathPrefix(
		accountId: string,
		pathPrefix: string,
		delimiter?: string,
	): Promise<MailboxItem[]>;
	findBySyncStatus(
		accountId: string,
		syncStatus: NonNullable<MailboxItem["syncStatus"]>,
	): Promise<MailboxItem[]>;
	renameChildPaths(
		accountId: string,
		oldPath: string,
		newPath: string,
		delimiter?: string,
	): Promise<void>;
}
