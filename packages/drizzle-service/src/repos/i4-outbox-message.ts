import type {
	CreateOutboxMessageInput,
	IOutboxMessageRepository,
	OutboxMessageItem,
	ResultList,
	UpdateOutboxMessageInput,
} from "@remit/data-ports";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ForbiddenError, NotFoundError } from "../error.js";
import { decodeToken, resultList } from "../pagination.js";
import { outboxMessageTable } from "../schema/i4-outbox-message.js";

type DB = NodePgDatabase<Record<string, unknown>>;

function rowToOutboxMessage(
	row: typeof outboxMessageTable.$inferSelect,
): OutboxMessageItem {
	return {
		outboxMessageId: row.outboxMessageId,
		accountId: row.accountId,
		accountConfigId: row.accountConfigId,
		fromAddress: row.fromAddress,
		fromName: row.fromName ?? undefined,
		toAddresses: (row.toAddresses as string[]) ?? [],
		ccAddresses: (row.ccAddresses as string[]) ?? [],
		bccAddresses: (row.bccAddresses as string[]) ?? [],
		replyToAddress: row.replyToAddress ?? undefined,
		subject: row.subject ?? undefined,
		messageIdValue: row.messageIdValue,
		inReplyTo: row.inReplyTo ?? undefined,
		references: (row.references as string[]) ?? [],
		textBody: row.textBody ?? undefined,
		htmlBody: row.htmlBody ?? undefined,
		status: row.status as OutboxMessageItem["status"],
		lastError: row.lastError ?? undefined,
		lastSmtpCode: row.lastSmtpCode ?? undefined,
		sentAt: row.sentAt ?? undefined,
		smtpMessageId: row.smtpMessageId ?? undefined,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class OutboxMessageRepo implements IOutboxMessageRepository {
	constructor(private db: DB) {}

	async create(input: CreateOutboxMessageInput): Promise<OutboxMessageItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(outboxMessageTable)
			.values({
				accountId: input.accountId,
				accountConfigId: input.accountConfigId,
				fromAddress: input.fromAddress,
				fromName: input.fromName,
				toAddresses: input.toAddresses ?? [],
				ccAddresses: input.ccAddresses ?? [],
				bccAddresses: input.bccAddresses ?? [],
				replyToAddress: input.replyToAddress,
				subject: input.subject,
				messageIdValue: input.messageIdValue,
				inReplyTo: input.inReplyTo,
				references: input.references ?? [],
				textBody: input.textBody,
				htmlBody: input.htmlBody,
				status: input.status,
				lastError: input.lastError,
				lastSmtpCode: input.lastSmtpCode,
				sentAt: input.sentAt,
				smtpMessageId: input.smtpMessageId,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return rowToOutboxMessage(row);
	}

	async get(
		accountConfigId: string,
		outboxMessageId: string,
		mode?: "read" | "act",
	): Promise<OutboxMessageItem>;
	async get(
		accountConfigId: string,
		outboxMessageIds: string[],
	): Promise<OutboxMessageItem[]>;
	async get(
		accountConfigId: string,
		outboxMessageId: string | string[],
		mode: "read" | "act" = "read",
	): Promise<OutboxMessageItem | OutboxMessageItem[]> {
		if (Array.isArray(outboxMessageId)) {
			if (outboxMessageId.length === 0) return [];
			const rows = await this.db
				.select()
				.from(outboxMessageTable)
				.where(
					and(
						eq(outboxMessageTable.accountConfigId, accountConfigId),
						inArray(outboxMessageTable.outboxMessageId, outboxMessageId),
					),
				);
			return rows.map(rowToOutboxMessage);
		}
		// Fetch unscoped by id so a foreign row can be distinguished from an
		// absent one — mode="act" reports the former as 403, not 404.
		const [row] = await this.db
			.select()
			.from(outboxMessageTable)
			.where(eq(outboxMessageTable.outboxMessageId, outboxMessageId));
		if (!row) {
			throw new NotFoundError(`OutboxMessage not found: ${outboxMessageId}`);
		}
		if (row.accountConfigId !== accountConfigId) {
			if (mode === "act") {
				throw new ForbiddenError(
					`OutboxMessage ${outboxMessageId} not in account config`,
				);
			}
			throw new NotFoundError(`OutboxMessage not found: ${outboxMessageId}`);
		}
		return rowToOutboxMessage(row);
	}

	async update(
		accountConfigId: string,
		outboxMessageId: string,
		input: UpdateOutboxMessageInput,
	): Promise<OutboxMessageItem> {
		const now = Date.now();
		const updates: Partial<typeof outboxMessageTable.$inferInsert> = {
			updatedAt: now,
		};
		if (input.status !== undefined) updates.status = input.status;
		if (input.lastError !== undefined) updates.lastError = input.lastError;
		if (input.lastSmtpCode !== undefined)
			updates.lastSmtpCode = input.lastSmtpCode;
		if (input.sentAt !== undefined) updates.sentAt = input.sentAt;
		if (input.smtpMessageId !== undefined)
			updates.smtpMessageId = input.smtpMessageId;
		if (input.toAddresses !== undefined)
			updates.toAddresses = input.toAddresses;
		if (input.ccAddresses !== undefined)
			updates.ccAddresses = input.ccAddresses;
		if (input.bccAddresses !== undefined)
			updates.bccAddresses = input.bccAddresses;
		if (input.subject !== undefined) updates.subject = input.subject;
		if (input.textBody !== undefined) updates.textBody = input.textBody;
		if (input.htmlBody !== undefined) updates.htmlBody = input.htmlBody;
		if (input.inReplyTo !== undefined) updates.inReplyTo = input.inReplyTo;
		if (input.references !== undefined) updates.references = input.references;

		const [row] = await this.db
			.update(outboxMessageTable)
			.set(updates)
			.where(
				and(
					eq(outboxMessageTable.accountConfigId, accountConfigId),
					eq(outboxMessageTable.outboxMessageId, outboxMessageId),
				),
			)
			.returning();
		if (!row)
			throw new NotFoundError(`OutboxMessage not found: ${outboxMessageId}`);
		return rowToOutboxMessage(row);
	}

	async updateStatus(
		accountConfigId: string,
		outboxMessageId: string,
		status: OutboxMessageItem["status"],
	): Promise<OutboxMessageItem> {
		return this.update(accountConfigId, outboxMessageId, { status });
	}

	async markSent(
		accountConfigId: string,
		outboxMessageId: string,
		fields: { sentAt: number; smtpMessageId?: string },
	): Promise<OutboxMessageItem> {
		const now = Date.now();
		const [row] = await this.db
			.update(outboxMessageTable)
			.set({
				status: "sent",
				sentAt: fields.sentAt,
				smtpMessageId: fields.smtpMessageId,
				lastError: null,
				lastSmtpCode: null,
				updatedAt: now,
			})
			.where(
				and(
					eq(outboxMessageTable.accountConfigId, accountConfigId),
					eq(outboxMessageTable.outboxMessageId, outboxMessageId),
				),
			)
			.returning();
		if (!row)
			throw new NotFoundError(`OutboxMessage not found: ${outboxMessageId}`);
		return rowToOutboxMessage(row);
	}

	async delete(
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<void> {
		await this.db
			.delete(outboxMessageTable)
			.where(
				and(
					eq(outboxMessageTable.accountConfigId, accountConfigId),
					eq(outboxMessageTable.outboxMessageId, outboxMessageId),
				),
			);
	}

	async deleteMany(
		accountConfigId: string,
		outboxMessageIds: string[],
	): Promise<void> {
		if (outboxMessageIds.length === 0) return;
		await this.db
			.delete(outboxMessageTable)
			.where(
				and(
					eq(outboxMessageTable.accountConfigId, accountConfigId),
					inArray(outboxMessageTable.outboxMessageId, outboxMessageIds),
				),
			);
	}

	async listByAccount(
		accountId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<OutboxMessageItem>> {
		const limit = options?.limit ?? 100;
		const cursor = options?.continuationToken
			? decodeToken(options.continuationToken)
			: undefined;
		const after = cursor
			? {
					createdAt: cursor.createdAt as number,
					outboxMessageId: cursor.outboxMessageId as string,
				}
			: undefined;

		const rows = await this.db
			.select()
			.from(outboxMessageTable)
			.where(
				and(
					eq(outboxMessageTable.accountId, accountId),
					after
						? or(
								lt(outboxMessageTable.createdAt, after.createdAt),
								and(
									eq(outboxMessageTable.createdAt, after.createdAt),
									lt(outboxMessageTable.outboxMessageId, after.outboxMessageId),
								),
							)
						: undefined,
				),
			)
			.orderBy(
				desc(outboxMessageTable.createdAt),
				desc(outboxMessageTable.outboxMessageId),
			)
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(rowToOutboxMessage);
		const lastItem = items[items.length - 1];
		return resultList(
			items,
			limit,
			hasMore && lastItem
				? {
						createdAt: lastItem.createdAt,
						outboxMessageId: lastItem.outboxMessageId,
					}
				: undefined,
		);
	}

	async listQueued(accountId: string): Promise<OutboxMessageItem[]> {
		const rows = await this.db
			.select()
			.from(outboxMessageTable)
			.where(
				and(
					eq(outboxMessageTable.accountId, accountId),
					eq(outboxMessageTable.status, "queued"),
				),
			);
		return rows.map(rowToOutboxMessage);
	}
}
