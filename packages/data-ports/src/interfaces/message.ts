import type {
	CreateMessageInput,
	MessageDescription,
	MessageIdSource,
	MessageItem,
	PlacementPredicate,
	PlacementTransitionInput,
	ResultList,
	UpdateMessageInput,
} from "../types.js";

export interface IMessageRepository {
	create(input: CreateMessageInput): Promise<MessageItem>;
	upsert(input: CreateMessageInput): Promise<MessageItem>;
	upsertWithStatus(
		input: CreateMessageInput,
	): Promise<{ item: MessageItem; created: boolean }>;
	get(messageId: string): Promise<MessageItem>;
	get(messageIds: string[]): Promise<MessageItem[]>;
	update(messageId: string, input: UpdateMessageInput): Promise<MessageItem>;
	clearBodyStorageKey(messageId: string): Promise<MessageItem>;
	clearSpamReport(messageId: string): Promise<MessageItem>;
	setSearchText(messageId: string, text: string): Promise<void>;
	listMissingSearchText(
		after: string,
		limit: number,
	): Promise<Array<{ messageId: string; bodyStorageKey: string }>>;
	delete(messageId: string): Promise<void>;
	deleteMany(messageIds: string[]): Promise<void>;
	/**
	 * Delete the row, its per-message subtree and its thread listings, only
	 * while its placement still matches what the caller read (imap-mutations
	 * R3). Resolves `false` when the predicate did not match and nothing was
	 * deleted.
	 */
	deleteIfPlacement(
		messageId: string,
		expected: PlacementPredicate,
	): Promise<boolean>;
	listByMailbox(
		mailboxId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<MessageItem>>;
	listAllByMailbox(mailboxId: string): Promise<MessageItem[]>;
	/** Rows `moving` or `deleting` that nothing has written since `untouchedSince`, uid-0 copies included. */
	listStrandedPlacements(
		mailboxIds: readonly string[],
		untouchedSince: number,
	): Promise<MessageItem[]>;
	describe(messageId: string): Promise<MessageDescription>;
	updateUid(
		messageId: string,
		newUid: number,
		newMailboxId: string,
	): Promise<MessageItem>;
	/**
	 * Move the row's placement from the state the caller read to the state it
	 * decided on, as one conditional write (imap-mutations R3). The only writer
	 * of `mailboxId`, `status`, `syncStatus`, `abandonedMutation`,
	 * `originalMailboxId` and `originalUid`, apart from the settle in
	 * {@link updateUid} — so a placement written without a predicate is a type
	 * error rather than a convention.
	 *
	 * Resolves with the written row when the predicate matched, and with
	 * `undefined` when it did not — someone else won, or the row is gone. The
	 * loser re-reads and re-decides; it never blind-retries and never writes
	 * anyway.
	 */
	transitionPlacement(
		messageId: string,
		expected: PlacementPredicate,
		next: PlacementTransitionInput,
	): Promise<MessageItem | undefined>;
	/**
	 * Re-point a row at the placement the mail server named for it, settled,
	 * only while it still sits where the caller read it (imap-mutations R1/R3):
	 * a user move landing in between wins and this writes nothing. The row's
	 * thread listings follow in the same batch, so the listing never shows the
	 * message in a folder its row has left. Resolves `false` when the
	 * predicate did not match.
	 */
	repointIfPlacement(
		messageId: string,
		expected: PlacementPredicate,
		to: { mailboxId: string; uid: number; isDeleted: boolean },
	): Promise<boolean>;
}

export type { MessageIdSource };
