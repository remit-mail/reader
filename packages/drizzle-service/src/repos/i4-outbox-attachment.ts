import type {
	CreateOutboxAttachmentInput,
	IOutboxAttachmentRepository,
	OutboxAttachmentCap,
	OutboxAttachmentItem,
	ReserveOutboxAttachmentResult,
} from "@remit/data-ports";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { outboxAttachmentTable } from "../schema/i4-outbox-attachment.js";
import { runInTransaction } from "../tx.js";

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

/** Stored, or reserved and not yet lapsed. Anything else holds no room. */
const holdsRoom = (item: OutboxAttachmentItem, nowSeconds: number): boolean =>
	item.state === "Stored" || item.reservationExpiresAt >= nowSeconds;

export class OutboxAttachmentRepo implements IOutboxAttachmentRepository {
	constructor(private db: DB) {}

	/**
	 * The per-message cap, enforced where the count and the insert are one
	 * operation. Two requests reserving at the same moment serialize here rather
	 * than each measuring a draft neither has written to.
	 */
	async reserve(
		input: CreateOutboxAttachmentInput,
		cap: OutboxAttachmentCap,
	): Promise<ReserveOutboxAttachmentResult> {
		return runInTransaction(this.db, async () => {
			const existing = await this.db
				.select()
				.from(outboxAttachmentTable)
				.where(
					and(
						eq(outboxAttachmentTable.accountConfigId, input.accountConfigId),
						eq(outboxAttachmentTable.outboxMessageId, input.outboxMessageId),
					),
				);

			const live = existing
				.map(rowToOutboxAttachment)
				.filter((item) => holdsRoom(item, cap.nowSeconds));
			const usedBytes = live.reduce((total, item) => total + item.sizeBytes, 0);

			if (live.length >= cap.maxCount) {
				return { outcome: "OverCountCap", usedBytes };
			}
			if (usedBytes + input.sizeBytes > cap.maxTotalBytes) {
				return { outcome: "OverByteCap", usedBytes };
			}

			const now = Date.now();
			const [row] = await this.db
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
				.returning();

			return { outcome: "Reserved", item: rowToOutboxAttachment(row) };
		});
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

export { holdsRoom };
