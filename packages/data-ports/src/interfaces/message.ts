import type {
	CreateMessageInput,
	MessageDescription,
	MessageIdSource,
	MessageItem,
	ResultList,
	UpdateMessageInput,
	UpdateMessageMoveInput,
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
	delete(messageId: string): Promise<void>;
	deleteMany(messageIds: string[]): Promise<void>;
	listByMailbox(
		mailboxId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<MessageItem>>;
	listAllByMailbox(mailboxId: string): Promise<MessageItem[]>;
	describe(messageId: string): Promise<MessageDescription>;
	updateForMove(
		messageId: string,
		input: UpdateMessageMoveInput,
	): Promise<MessageItem>;
	updateUid(
		messageId: string,
		newUid: number,
		newMailboxId: string,
	): Promise<MessageItem>;
}

export type { MessageIdSource };
