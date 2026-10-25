import type {
	CreateOutboxAttachmentInput,
	IOutboxAttachmentRepository,
	OutboxAttachmentCap,
	OutboxAttachmentItem,
	ReserveOutboxAttachmentResult,
} from "@remit/data-ports";
import { holdsRoom } from "@remit/data-ports";
import { and, eq, gt, gte, lt, or, sum } from "drizzle-orm";
import type { WriteBatch } from "../batch.js";
import type { RepositoryDb, SqliteStore } from "../db.js";
import { NotFoundError } from "../error.js";
import { outboxAttachmentTable } from "../schema/i4-outbox-attachment.js";
import { inList } from "./in-list.js";

type DB = RepositoryDb<Record<string, unknown>>;

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
	private readonly db: DB;
	private readonly batch: WriteBatch;

	constructor(store: SqliteStore<Record<string, unknown>>) {
		this.db = store.db;
		this.batch = store.batch;
	}

	/**
	 * The per-message cap. The insert, the read of the draft's live rows and a
	 * delete of the new row when it breaks the cap run as one batch, which
	 * commits as a unit and serializes against every other batch. Of two
	 * concurrent reservations the later one sees the earlier one's row, so it
	 * is the one removed when the two together do not fit.
	 */
	async reserve(
		input: CreateOutboxAttachmentInput,
		cap: OutboxAttachmentCap,
	): Promise<ReserveOutboxAttachmentResult> {
		const now = Date.now();
		const draft = and(
			eq(outboxAttachmentTable.accountConfigId, input.accountConfigId),
			eq(outboxAttachmentTable.outboxMessageId, input.outboxMessageId),
		);
		const live = and(
			draft,
			or(
				eq(outboxAttachmentTable.state, "Stored"),
				gte(outboxAttachmentTable.reservationExpiresAt, cap.nowSeconds),
			),
		);
		const [inserted, rows, removed] = await this.batch([
			this.db
				.insert(outboxAttachmentTable)
				.values({
					outboxAttachmentId: input.outboxAttachmentId,
					outboxMessageId: input.outboxMessageId,
					accountId: input.accountId,
					accountConfigId: input.accountConfigId,
					filename: input.filename,
					contentType: input.contentType,
					sizeBytes: input.sizeBytes,
					state: "Pending",
					storageKey: input.storageKey,
					reservationExpiresAt: input.reservationExpiresAt,
					createdAt: now,
					updatedAt: now,
				})
				.returning(),
			this.db.select().from(outboxAttachmentTable).where(draft),
			this.db
				.delete(outboxAttachmentTable)
				.where(
					and(
						eq(
							outboxAttachmentTable.outboxAttachmentId,
							input.outboxAttachmentId,
						),
						or(
							gt(this.db.$count(outboxAttachmentTable, live), cap.maxCount),
							gt(
								this.db
									.select({ total: sum(outboxAttachmentTable.sizeBytes) })
									.from(outboxAttachmentTable)
									.where(live),
								cap.maxTotalBytes,
							),
						),
					),
				)
				.returning({
					outboxAttachmentId: outboxAttachmentTable.outboxAttachmentId,
				}),
		] as const);

		const others = rows
			.map(rowToOutboxAttachment)
			.filter(
				(item) =>
					item.outboxAttachmentId !== input.outboxAttachmentId &&
					holdsRoom(item, cap.nowSeconds),
			);
		const usedBytes = others.reduce((total, item) => total + item.sizeBytes, 0);
		const [row] = inserted;
		if (removed.length === 0 && row) {
			return { outcome: "Reserved", item: rowToOutboxAttachment(row) };
		}
		if (others.length >= cap.maxCount) {
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
					inList(outboxAttachmentTable.outboxAttachmentId, outboxAttachmentIds),
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
