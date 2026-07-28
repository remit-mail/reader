import type {
	CreateMessageLabelInput,
	IMessageLabelRepository,
	MessageLabelItem,
} from "@remit/data-ports";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db.js";
import { deterministicBase36Id } from "../id.js";
import { messageLabelTable } from "../schema.js";

type DB = Db<Record<string, unknown>>;

function rowToMessageLabel(
	row: typeof messageLabelTable.$inferSelect,
): MessageLabelItem {
	return {
		messageLabelId: row.messageLabelId,
		messageId: row.messageId,
		labelId: row.labelId,
		accountConfigId: row.accountConfigId,
		appliedByFilterId: row.appliedByFilterId ?? undefined,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class MessageLabelRepo implements IMessageLabelRepository {
	constructor(private db: DB) {}

	/**
	 * Deterministic primary key: base36 UUIDv5 of (messageId, labelId), the same
	 * derivation the electrodb adapter uses, so applying the same label twice is
	 * idempotent on either backend (RFC 030).
	 */
	static deriveId(messageId: string, labelId: string): string {
		return deterministicBase36Id(`messageLabel:${messageId}:${labelId}`);
	}

	async apply(input: CreateMessageLabelInput): Promise<MessageLabelItem> {
		const now = Date.now();
		const messageLabelId = MessageLabelRepo.deriveId(
			input.messageId,
			input.labelId,
		);
		const appliedByFilterId = input.appliedByFilterId ?? null;
		const [row] = await this.db
			.insert(messageLabelTable)
			.values({
				messageLabelId,
				messageId: input.messageId,
				labelId: input.labelId,
				accountConfigId: input.accountConfigId,
				appliedByFilterId,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: messageLabelTable.messageLabelId,
				set: { appliedByFilterId, updatedAt: now },
			})
			.returning();
		return rowToMessageLabel(row);
	}

	async remove(messageId: string, labelId: string): Promise<void> {
		const messageLabelId = MessageLabelRepo.deriveId(messageId, labelId);
		await this.db
			.delete(messageLabelTable)
			.where(eq(messageLabelTable.messageLabelId, messageLabelId));
	}

	async listByMessageId(messageId: string): Promise<MessageLabelItem[]> {
		const rows = await this.db
			.select()
			.from(messageLabelTable)
			.where(eq(messageLabelTable.messageId, messageId));
		return rows.map(rowToMessageLabel);
	}

	async listByMessageIds(messageIds: string[]): Promise<MessageLabelItem[]> {
		if (messageIds.length === 0) return [];
		const rows = await this.db
			.select()
			.from(messageLabelTable)
			.where(inArray(messageLabelTable.messageId, messageIds));
		return rows.map(rowToMessageLabel);
	}

	async listByLabelId(
		accountConfigId: string,
		labelId: string,
	): Promise<MessageLabelItem[]> {
		const rows = await this.db
			.select()
			.from(messageLabelTable)
			.where(
				and(
					eq(messageLabelTable.accountConfigId, accountConfigId),
					eq(messageLabelTable.labelId, labelId),
				),
			)
			.orderBy(desc(messageLabelTable.createdAt));
		return rows.map(rowToMessageLabel);
	}

	async removeAllByLabelId(
		accountConfigId: string,
		labelId: string,
	): Promise<void> {
		await this.db
			.delete(messageLabelTable)
			.where(
				and(
					eq(messageLabelTable.accountConfigId, accountConfigId),
					eq(messageLabelTable.labelId, labelId),
				),
			);
	}
}
