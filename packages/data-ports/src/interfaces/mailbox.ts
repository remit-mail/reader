import type {
	CreateMailboxInput,
	MailboxItem,
	MailboxSubtreeTransitionIntent,
	MailboxTransitionIntent,
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
	/**
	 * Move one folder's mutation state from the state the caller read to the
	 * state it decided on, as one conditional write
	 * (docs/architecture/folder-rename-and-delete.md D3). The only writer of
	 * `syncStatus` and `pendingPath` — so a folder state written without a
	 * predicate is a type error rather than a convention.
	 *
	 * The predicate names one of the six states, not one of the four enum
	 * values: `wherePendingPath` as a string requires equality, `null` requires
	 * the column to be NULL, and omitting it predicates on `syncStatus` alone.
	 * A create settle that leaves it out matches a row a rename has claimed and
	 * strands it `synced` with a target on it, which is the seventh combination
	 * the invariant forbids.
	 *
	 * Resolves with the written row when the predicate matched, and with `null`
	 * when it did not — the row is absent, or somebody else won. The loser
	 * re-reads and re-decides; it never blind-retries and never writes anyway.
	 */
	transition(
		accountId: string,
		mailboxId: string,
		intent: MailboxTransitionIntent,
	): Promise<MailboxItem | null>;
	/**
	 * Record one intent across a folder and every descendant, all-or-nothing, in
	 * one transaction (D6). Each row's UPDATE carries the from-state predicate
	 * and the affected-row count is compared to the resolved subtree, so a
	 * concurrent single-row transition rolls the whole thing back rather than
	 * being missed by a prior read.
	 *
	 * Resolves with every written row, or with `null` when any row in the
	 * subtree was not in an accepted from-state — in which case nothing was
	 * written. This serves the intent only: a settle is per-row (D15).
	 */
	transitionSubtree(
		accountId: string,
		mailboxId: string,
		intent: MailboxSubtreeTransitionIntent,
	): Promise<MailboxItem[] | null>;
	delete(accountId: string, mailboxId: string): Promise<void>;
	deleteMany(accountId: string, mailboxIds: string[]): Promise<void>;
	/**
	 * Remove a folder along with the mail it holds (D8): the messages through
	 * `deleteMessageSubtree`, so the nine per-message child tables go and one
	 * `message.removed` outbox row per message clears the search index; then the
	 * mailbox's own child rows; then, last, the mailbox row itself.
	 *
	 * Ordered, batched and resumable rather than one transaction — the caller
	 * keeps the row `deleting` until this returns, so a redelivery re-enters and
	 * continues. `filter` rows bound to this mailbox are never touched: D16
	 * refuses the delete while any binding stands, so there is nothing to unbind
	 * and deleting a user's filters is not a folder delete's decision.
	 */
	deleteMailboxWithMail(accountId: string, mailboxId: string): Promise<void>;
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
		syncStatus: MailboxItem["syncStatus"],
	): Promise<MailboxItem[]>;
}
