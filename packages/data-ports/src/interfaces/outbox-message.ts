import type {
	CreateOutboxMessageInput,
	OutboxMessageItem,
	ResultList,
	UpdateOutboxMessageInput,
} from "../types.js";

export interface IOutboxMessageRepository {
	create(input: CreateOutboxMessageInput): Promise<OutboxMessageItem>;
	get(
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<OutboxMessageItem>;
	get(
		accountConfigId: string,
		outboxMessageIds: string[],
	): Promise<OutboxMessageItem[]>;
	update(
		accountConfigId: string,
		outboxMessageId: string,
		input: UpdateOutboxMessageInput,
	): Promise<OutboxMessageItem>;
	updateStatus(
		accountConfigId: string,
		outboxMessageId: string,
		status: OutboxMessageItem["status"],
	): Promise<OutboxMessageItem>;
	markSent(
		accountConfigId: string,
		outboxMessageId: string,
		fields: { sentAt: number; smtpMessageId?: string },
	): Promise<OutboxMessageItem>;
	delete(accountConfigId: string, outboxMessageId: string): Promise<void>;
	deleteMany(
		accountConfigId: string,
		outboxMessageIds: string[],
	): Promise<void>;
	listByAccount(
		accountId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<OutboxMessageItem>>;
	listQueued(accountId: string): Promise<OutboxMessageItem[]>;
}
