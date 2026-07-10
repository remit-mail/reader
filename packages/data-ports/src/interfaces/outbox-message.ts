import type {
	CreateOutboxMessageInput,
	OutboxMessageItem,
	ResultList,
	UpdateOutboxMessageInput,
} from "../types.js";

export interface IOutboxMessageRepository {
	create(input: CreateOutboxMessageInput): Promise<OutboxMessageItem>;
	/**
	 * `mode: "read"` (default) throws NotFoundError on a foreign message so a
	 * GET doesn't leak existence. `mode: "act"` throws ForbiddenError instead,
	 * for action verbs (PATCH/POST/DELETE) where the caller has already named
	 * the resource and the API contract says to explicitly deny rather than
	 * feign 404 — see assertAccountOwnership / assertMessagesOwned.
	 */
	get(
		accountConfigId: string,
		outboxMessageId: string,
		mode?: "read" | "act",
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
