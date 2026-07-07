import { randomUUID } from "node:crypto";
import type {
	CreateMessageFlagInput,
	IMessageFlagRepository,
	MessageFlagItem,
} from "@remit/data-ports";
import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NotFoundError } from "../error.js";
import {
	type MessageDataSchema,
	messageFlagTable,
} from "../schema/message-data.js";

type DB = NodePgDatabase<MessageDataSchema>;

function rowToMessageFlag(
	row: typeof messageFlagTable.$inferSelect,
): MessageFlagItem {
	return {
		messageFlagId: row.messageFlagId,
		messageId: row.messageId,
		flagName: row.flagName,
		setAt: row.setAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class DrizzleMessageFlagRepository implements IMessageFlagRepository {
	constructor(private db: DB) {}

	async create(input: CreateMessageFlagInput): Promise<MessageFlagItem> {
		const now = Date.now();
		const messageFlagId = randomUUID();
		const [row] = await this.db
			.insert(messageFlagTable)
			.values({
				messageFlagId,
				messageId: input.messageId,
				flagName: input.flagName,
				setAt: input.setAt,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		if (!row) throw new NotFoundError(`MessageFlag create failed`);
		return rowToMessageFlag(row);
	}

	async get(messageFlagId: string): Promise<MessageFlagItem>;
	async get(messageFlagIds: string[]): Promise<MessageFlagItem[]>;
	async get(
		idOrIds: string | string[],
	): Promise<MessageFlagItem | MessageFlagItem[]> {
		if (Array.isArray(idOrIds)) {
			if (idOrIds.length === 0) return [];
			const rows = await this.db
				.select()
				.from(messageFlagTable)
				.where(inArray(messageFlagTable.messageFlagId, idOrIds));
			return rows.map(rowToMessageFlag);
		}
		const [row] = await this.db
			.select()
			.from(messageFlagTable)
			.where(eq(messageFlagTable.messageFlagId, idOrIds));
		if (!row) throw new NotFoundError(`MessageFlag not found: ${idOrIds}`);
		return rowToMessageFlag(row);
	}

	async delete(messageFlagId: string): Promise<void> {
		await this.db
			.delete(messageFlagTable)
			.where(eq(messageFlagTable.messageFlagId, messageFlagId));
	}

	async deleteMany(messageFlagIds: string[]): Promise<void> {
		if (messageFlagIds.length === 0) return;
		await this.db
			.delete(messageFlagTable)
			.where(inArray(messageFlagTable.messageFlagId, messageFlagIds));
	}

	async getFlags(messageId: string): Promise<MessageFlagItem[]> {
		const rows = await this.db
			.select()
			.from(messageFlagTable)
			.where(eq(messageFlagTable.messageId, messageId));
		return rows.map(rowToMessageFlag);
	}

	async hasFlag(messageId: string, flagName: string): Promise<boolean> {
		const [row] = await this.db
			.select()
			.from(messageFlagTable)
			.where(
				and(
					eq(messageFlagTable.messageId, messageId),
					eq(messageFlagTable.flagName, flagName),
				),
			);
		return row !== undefined;
	}

	async addFlag(messageId: string, flagName: string): Promise<MessageFlagItem> {
		const existing = await this.db
			.select()
			.from(messageFlagTable)
			.where(
				and(
					eq(messageFlagTable.messageId, messageId),
					eq(messageFlagTable.flagName, flagName),
				),
			);
		if (existing[0]) return rowToMessageFlag(existing[0]);
		const now = Date.now();
		const messageFlagId = randomUUID();
		const [row] = await this.db
			.insert(messageFlagTable)
			.values({
				messageFlagId,
				messageId,
				flagName,
				setAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		if (!row) throw new NotFoundError(`MessageFlag addFlag failed`);
		return rowToMessageFlag(row);
	}

	async removeFlag(messageId: string, flagName: string): Promise<void> {
		await this.db
			.delete(messageFlagTable)
			.where(
				and(
					eq(messageFlagTable.messageId, messageId),
					eq(messageFlagTable.flagName, flagName),
				),
			);
	}

	async addFlags(messageId: string, flagNames: string[]): Promise<void> {
		for (const flagName of flagNames) {
			await this.addFlag(messageId, flagName);
		}
	}

	async removeFlags(messageId: string, flagNames: string[]): Promise<void> {
		if (flagNames.length === 0) return;
		await this.db
			.delete(messageFlagTable)
			.where(
				and(
					eq(messageFlagTable.messageId, messageId),
					inArray(messageFlagTable.flagName, flagNames),
				),
			);
	}
}
