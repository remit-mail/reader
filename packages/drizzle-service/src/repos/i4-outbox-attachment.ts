import type {
	CreateOutboxAttachmentInput,
	IOutboxAttachmentRepository,
	OutboxAttachmentCap,
	OutboxAttachmentItem,
	ReserveOutboxAttachmentResult,
} from "@remit/data-ports";
import {
	and,
	count,
	eq,
	gte,
	lt,
	lte,
	ne,
	or,
	type SQLWrapper,
	sql,
	sum,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { WriteBatch } from "../batch.js";
import type { RepositoryDb, SqliteStore } from "../db.js";
import { NotFoundError } from "../error.js";
import { outboxAttachmentTable } from "../schema/i4-outbox-attachment.js";
import { inList } from "./in-list.js";

type DB = RepositoryDb;

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

	private quota(
		accountConfigId: string,
		outboxMessageId: string | SQLWrapper,
		outboxAttachmentId: string,
		sizeBytes: number | SQLWrapper,
		cap: OutboxAttachmentCap,
	) {
		const other = alias(outboxAttachmentTable, "other_attachment");
		const liveOthers = and(
			eq(other.accountConfigId, accountConfigId),
			eq(other.outboxMessageId, outboxMessageId),
			ne(other.outboxAttachmentId, outboxAttachmentId),
			or(
				eq(other.state, "Stored"),
				gte(other.reservationExpiresAt, cap.nowSeconds),
			),
		);
		const usedCount = sql<number>`(${this.db.select({ count: count() }).from(other).where(liveOthers)})`;
		const total = this.db
			.select({ bytes: sum(other.sizeBytes) })
			.from(other)
			.where(liveOthers);
		const usedBytes = sql<number>`coalesce((${total}), 0)`;
		return {
			summary: { usedCount, usedBytes },
			fits: and(
				lt(usedCount, cap.maxCount),
				lte(sql`${usedBytes} + ${sizeBytes}`, cap.maxTotalBytes),
			),
		};
	}

	/** The quota summary and guarded insert run in one atomic batch. */
	async reserve(
		input: CreateOutboxAttachmentInput,
		cap: OutboxAttachmentCap,
	): Promise<ReserveOutboxAttachmentResult> {
		const now = Date.now();
		const quota = this.quota(
			input.accountConfigId,
			input.outboxMessageId,
			input.outboxAttachmentId,
			input.sizeBytes,
			cap,
		);
		const [summaries, inserted] = await this.batch([
			this.db.select(quota.summary).from(sql`(select 1)`),
			this.db
				.insert(outboxAttachmentTable)
				.select(
					this.db
						.select({
							outboxAttachmentId: sql<string>`${input.outboxAttachmentId}`.as(
								"outboxAttachmentId",
							),
							outboxMessageId: sql<string>`${input.outboxMessageId}`.as(
								"outboxMessageId",
							),
							accountId: sql<string>`${input.accountId}`.as("accountId"),
							accountConfigId: sql<string>`${input.accountConfigId}`.as(
								"accountConfigId",
							),
							filename: sql<string>`${input.filename}`.as("filename"),
							contentType: sql<string>`${input.contentType}`.as("contentType"),
							sizeBytes: sql<number>`${input.sizeBytes}`.as("sizeBytes"),
							state: sql<string>`'Pending'`.as("state"),
							storageKey: sql<string>`${input.storageKey}`.as("storageKey"),
							reservationExpiresAt:
								sql<number>`${input.reservationExpiresAt}`.as(
									"reservationExpiresAt",
								),
							createdAt: sql<number>`${now}`.as("createdAt"),
							updatedAt: sql<number>`${now}`.as("updatedAt"),
						})
						.from(sql`(select 1)`)
						.where(quota.fits),
				)
				.returning(),
		] as const);
		const [row] = inserted;
		if (row) return { outcome: "Reserved", item: rowToOutboxAttachment(row) };
		const [summary] = summaries;
		return {
			outcome:
				summary.usedCount >= cap.maxCount ? "OverCountCap" : "OverByteCap",
			usedBytes: summary.usedBytes,
		};
	}

	async renew(
		input: Pick<
			CreateOutboxAttachmentInput,
			| "accountConfigId"
			| "outboxMessageId"
			| "outboxAttachmentId"
			| "reservationExpiresAt"
		>,
		cap: OutboxAttachmentCap,
	): Promise<ReserveOutboxAttachmentResult | { outcome: "Missing" }> {
		const draft = and(
			eq(outboxAttachmentTable.accountConfigId, input.accountConfigId),
			eq(outboxAttachmentTable.outboxMessageId, input.outboxMessageId),
		);
		const quota = this.quota(
			input.accountConfigId,
			input.outboxMessageId,
			input.outboxAttachmentId,
			outboxAttachmentTable.sizeBytes,
			cap,
		);
		const [summaries, updated] = await this.batch([
			this.db
				.select(quota.summary)
				.from(outboxAttachmentTable)
				.where(
					and(
						draft,
						eq(
							outboxAttachmentTable.outboxAttachmentId,
							input.outboxAttachmentId,
						),
						eq(outboxAttachmentTable.state, "Pending"),
					),
				)
				.limit(1),
			this.db
				.update(outboxAttachmentTable)
				.set({
					reservationExpiresAt: input.reservationExpiresAt,
					updatedAt: Date.now(),
				})
				.where(
					and(
						draft,
						eq(
							outboxAttachmentTable.outboxAttachmentId,
							input.outboxAttachmentId,
						),
						eq(outboxAttachmentTable.state, "Pending"),
						quota.fits,
					),
				)
				.returning(),
		] as const);
		const [row] = updated;
		if (row) return { outcome: "Reserved", item: rowToOutboxAttachment(row) };
		const [summary] = summaries;
		if (!summary) return { outcome: "Missing" };
		return {
			outcome:
				summary.usedCount >= cap.maxCount ? "OverCountCap" : "OverByteCap",
			usedBytes: summary.usedBytes,
		};
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
	 * Only a Pending row that still fits the caps may become Stored. The quota
	 * guard runs at this final write, even if storage verification crossed its
	 * reservation expiry. The update names Pending in its WHERE — two completions for
	 * the same upload cannot both believe they were the one that confirmed it.
	 */
	async markStored(
		accountConfigId: string,
		outboxAttachmentId: string,
		sizeBytes: number,
		cap: OutboxAttachmentCap,
	): Promise<OutboxAttachmentItem | null> {
		const quota = this.quota(
			accountConfigId,
			outboxAttachmentTable.outboxMessageId,
			outboxAttachmentId,
			sizeBytes,
			cap,
		);
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
					quota.fits,
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
