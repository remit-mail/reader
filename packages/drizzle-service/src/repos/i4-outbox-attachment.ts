import type {
	CreateOutboxAttachmentInput,
	IOutboxAttachmentRepository,
	OutboxAttachmentCap,
	OutboxAttachmentItem,
	ReserveOutboxAttachmentResult,
} from "@remit/data-ports";
import { and, eq, gte, inArray, lt, lte, or, sql, sum } from "drizzle-orm";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { outboxAttachmentTable } from "../schema/i4-outbox-attachment.js";

type DB = Db<Record<string, unknown>>;

function rowToOutboxAttachment(
	row: typeof outboxAttachmentTable.$inferSelect,
): OutboxAttachmentItem {
	return {
		outboxAttachmentId: row.outboxAttachmentId,
		outboxMessageId: row.outboxMessageId,
		accountId: row.accountId,
		accountConfigId: row.accountConfigId,
		filename: row.filename,
		contentType: row.contentType,
		sizeBytes: row.sizeBytes,
		state: row.state as OutboxAttachmentItem["state"],
		storageKey: row.storageKey,
		reservationExpiresAt: row.reservationExpiresAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class OutboxAttachmentRepo implements IOutboxAttachmentRepository {
	constructor(private db: DB) {}

	/**
	 * The per-message cap, as one conditional insert: the row is written only
	 * while the draft's live rows leave room for it, and the count and the sum
	 * are read by the same statement that writes. Of two concurrent
	 * reservations the later one sees the earlier one's row.
	 */
	async reserve(
		input: CreateOutboxAttachmentInput,
		cap: OutboxAttachmentCap,
	): Promise<ReserveOutboxAttachmentResult> {
		const now = Date.now();
		const live = and(
			eq(outboxAttachmentTable.accountConfigId, input.accountConfigId),
			eq(outboxAttachmentTable.outboxMessageId, input.outboxMessageId),
			or(
				eq(outboxAttachmentTable.state, "Stored"),
				gte(outboxAttachmentTable.reservationExpiresAt, cap.nowSeconds),
			),
		);
		const used = this.db
			.select({ total: sum(outboxAttachmentTable.sizeBytes) })
			.from(outboxAttachmentTable)
			.where(live);
		const fits = and(
			lt(this.db.$count(outboxAttachmentTable, live), cap.maxCount),
			lte(sql`coalesce((${used}), 0)`, cap.maxTotalBytes - input.sizeBytes),
		);
		const constant = <T>(value: T, name: string) => sql<T>`${value}`.as(name);

		const [row] = await this.db
			.insert(outboxAttachmentTable)
			.select(
				this.db
					.select({
						outboxAttachmentId: constant(
							input.outboxAttachmentId,
							"outbox_attachment_id",
						),
						outboxMessageId: constant(
							input.outboxMessageId,
							"outbox_message_id",
						),
						accountId: constant(input.accountId, "account_id"),
						accountConfigId: constant(
							input.accountConfigId,
							"account_config_id",
						),
						filename: constant(input.filename, "filename"),
						contentType: constant(input.contentType, "content_type"),
						sizeBytes: constant(input.sizeBytes, "size_bytes"),
						state: constant("Pending" as const, "state"),
						storageKey: constant(input.storageKey, "storage_key"),
						reservationExpiresAt: constant(
							input.reservationExpiresAt,
							"reservation_expires_at",
						),
						createdAt: constant(now, "created_at"),
						updatedAt: constant(now, "updated_at"),
					})
					.from(sql`(select 1)`)
					.where(fits),
			)
			.returning();
		if (row) return { outcome: "Reserved", item: rowToOutboxAttachment(row) };

		const held = (
			await this.db.select().from(outboxAttachmentTable).where(live)
		).map(rowToOutboxAttachment);
		const usedBytes = held.reduce((total, item) => total + item.sizeBytes, 0);
		if (held.length >= cap.maxCount) {
			return { outcome: "OverCountCap", usedBytes };
		}
		return { outcome: "OverByteCap", usedBytes };
	}

	async get(
		accountConfigId: string,
		outboxAttachmentId: string,
	): Promise<OutboxAttachmentItem> {
		const [row] = await this.db
			.select()
			.from(outboxAttachmentTable)
			.where(
				and(
					eq(outboxAttachmentTable.accountConfigId, accountConfigId),
					eq(outboxAttachmentTable.outboxAttachmentId, outboxAttachmentId),
				),
			)
			.limit(1);
		if (!row) {
			throw new NotFoundError(`No outbox attachment ${outboxAttachmentId}`);
		}
		return rowToOutboxAttachment(row);
	}

	async listByOutboxMessage(
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<OutboxAttachmentItem[]> {
		const rows = await this.db
			.select()
			.from(outboxAttachmentTable)
			.where(
				and(
					eq(outboxAttachmentTable.accountConfigId, accountConfigId),
					eq(outboxAttachmentTable.outboxMessageId, outboxMessageId),
				),
			);
		return rows.map(rowToOutboxAttachment);
	}

	/**
	 * Only a Pending row that has not lapsed may become Stored, and the update
	 * says so in its WHERE rather than in a preceding read — two completions for
	 * the same upload cannot both believe they were the one that confirmed it.
	 */
	async markStored(
		accountConfigId: string,
		outboxAttachmentId: string,
		sizeBytes: number,
	): Promise<OutboxAttachmentItem | null> {
		const [row] = await this.db
			.update(outboxAttachmentTable)
			.set({
				state: "Stored",
				sizeBytes,
				// Stored rows hold room forever, so the expiry has nothing left to
				// say. Zero is that, explicitly.
				reservationExpiresAt: 0,
				updatedAt: Date.now(),
			})
			.where(
				and(
					eq(outboxAttachmentTable.accountConfigId, accountConfigId),
					eq(outboxAttachmentTable.outboxAttachmentId, outboxAttachmentId),
					eq(outboxAttachmentTable.state, "Pending"),
				),
			)
			.returning();

		return row ? rowToOutboxAttachment(row) : null;
	}

	async deleteLapsedReservations(
		accountConfigId: string,
		outboxMessageId: string,
		nowSeconds: number,
	): Promise<string[]> {
		const rows = await this.db
			.delete(outboxAttachmentTable)
			.where(
				and(
					eq(outboxAttachmentTable.accountConfigId, accountConfigId),
					eq(outboxAttachmentTable.outboxMessageId, outboxMessageId),
					eq(outboxAttachmentTable.state, "Pending"),
					lt(outboxAttachmentTable.reservationExpiresAt, nowSeconds),
				),
			)
			.returning();
		return rows.map((row) => row.outboxAttachmentId);
	}

	async deleteMany(
		accountConfigId: string,
		outboxAttachmentIds: string[],
	): Promise<void> {
		if (outboxAttachmentIds.length === 0) return;
		await this.db
			.delete(outboxAttachmentTable)
			.where(
				and(
					eq(outboxAttachmentTable.accountConfigId, accountConfigId),
					inArray(
						outboxAttachmentTable.outboxAttachmentId,
						outboxAttachmentIds,
					),
				),
			);
	}

	async deleteByOutboxMessage(
		accountConfigId: string,
		outboxMessageId: string,
	): Promise<void> {
		await this.db
			.delete(outboxAttachmentTable)
			.where(
				and(
					eq(outboxAttachmentTable.accountConfigId, accountConfigId),
					eq(outboxAttachmentTable.outboxMessageId, outboxMessageId),
				),
			);
	}
}
