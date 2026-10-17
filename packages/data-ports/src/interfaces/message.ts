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
	delete(messageId: string): Promise<void>;
	deleteMany(messageIds: string[]): Promise<void>;
	/**
	 * Delete the row only while its placement still matches what the caller
	 * read (imap-mutations R3). Resolves `false` when the predicate did not
	 * match and nothing was deleted.
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
	/** Copy rows carry no source pair and are never listed. */
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
}

export type { MessageIdSource };
