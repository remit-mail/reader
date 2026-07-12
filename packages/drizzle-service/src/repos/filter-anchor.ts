import type {
	CreateFilterAnchorInput,
	FilterAnchorItem,
	IFilterAnchorRepository,
} from "@remit/data-ports";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { filterAnchorTable } from "../schema.js";

type DB = NodePgDatabase<Record<string, unknown>>;

function rowToFilterAnchor(
	row: typeof filterAnchorTable.$inferSelect,
): FilterAnchorItem {
	return {
		accountConfigId: row.accountConfigId,
		filterId: row.filterId,
		anchorEmbedding: row.anchorEmbedding as number[],
		anchorEmbeddingId: row.anchorEmbeddingId,
		anchorSourceText: row.anchorSourceText,
		anchorMessageId: row.anchorMessageId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * Postgres counterpart to `FilterAnchorService` (remit-electrodb-service). The
 * anchor vector is persisted inline on the row (RFC 034 Decision 2.1/2.3); the
 * pgvector store's per-message chunk vectors are read only by the search
 * service when it builds the anchor, never re-derived here at match time.
 */
export class FilterAnchorRepo implements IFilterAnchorRepository {
	constructor(private db: DB) {}

	/**
	 * Upsert — a filter's anchor is (re)computed once at save time (RFC 034
	 * Decision 2.1) and again only by an explicit re-embed migration
	 * (Decision 2.4).
	 */
	async put(input: CreateFilterAnchorInput): Promise<FilterAnchorItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(filterAnchorTable)
			.values({
				accountConfigId: input.accountConfigId,
				filterId: input.filterId,
				anchorEmbedding: input.anchorEmbedding,
				anchorEmbeddingId: input.anchorEmbeddingId,
				anchorSourceText: input.anchorSourceText,
				anchorMessageId: input.anchorMessageId,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [filterAnchorTable.accountConfigId, filterAnchorTable.filterId],
				set: {
					anchorEmbedding: input.anchorEmbedding,
					anchorEmbeddingId: input.anchorEmbeddingId,
					anchorSourceText: input.anchorSourceText,
					anchorMessageId: input.anchorMessageId,
					updatedAt: now,
				},
			})
			.returning();
		return rowToFilterAnchor(row);
	}

	async get(
		accountConfigId: string,
		filterId: string,
	): Promise<FilterAnchorItem | null> {
		const [row] = await this.db
			.select()
			.from(filterAnchorTable)
			.where(
				and(
					eq(filterAnchorTable.accountConfigId, accountConfigId),
					eq(filterAnchorTable.filterId, filterId),
				),
			);
		return row ? rowToFilterAnchor(row) : null;
	}

	async listByAccountConfig(
		accountConfigId: string,
	): Promise<FilterAnchorItem[]> {
		const rows = await this.db
			.select()
			.from(filterAnchorTable)
			.where(eq(filterAnchorTable.accountConfigId, accountConfigId));
		return rows.map(rowToFilterAnchor);
	}

	async delete(accountConfigId: string, filterId: string): Promise<void> {
		await this.db
			.delete(filterAnchorTable)
			.where(
				and(
					eq(filterAnchorTable.accountConfigId, accountConfigId),
					eq(filterAnchorTable.filterId, filterId),
				),
			);
	}
}
