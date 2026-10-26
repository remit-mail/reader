import type {
	ISyncWarningRepository,
	SurfacedSyncWarnings,
	SyncWarningItem,
	SyncWarningKey,
} from "@remit/data-ports";
import { deriveSyncWarningId } from "@remit/data-ports/id";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { WriteBatch } from "../batch.js";
import { chunkRows } from "../bound-parameters.js";
import type { RepositoryDb, SqliteStore } from "../db.js";
import { syncWarningTable } from "../schema/sync-warning.js";
import { inList } from "./in-list.js";

type DB = RepositoryDb<Record<string, unknown>>;

export class SyncWarningRepo implements ISyncWarningRepository {
	private readonly db: DB;
	private readonly batch: WriteBatch;
	private readonly maxBoundParameters: number;

	constructor(store: SqliteStore<Record<string, unknown>>) {
		this.db = store.db;
		this.batch = store.batch;
		this.maxBoundParameters = store.maxBoundParameters;
	}

	listByMailboxId = async (mailboxId: string): Promise<SyncWarningItem[]> =>
		this.db
			.select()
			.from(syncWarningTable)
			.where(eq(syncWarningTable.mailboxId, mailboxId));

	listSurfacedByAccountConfigId = async (
		accountConfigId: string,
		minAttempts: number,
		limit: number,
	): Promise<SurfacedSyncWarnings> => {
		const surfaced = and(
			eq(syncWarningTable.accountConfigId, accountConfigId),
			gte(syncWarningTable.attempts, minAttempts),
		);
		const items = await this.db
			.select()
			.from(syncWarningTable)
			.where(surfaced)
			.orderBy(desc(syncWarningTable.createdAt))
			.limit(limit);
		const [{ total }] = await this.db
			.select({ total: count() })
			.from(syncWarningTable)
			.where(surfaced);
		return { items, total };
	};

	recordFailures = async (keys: SyncWarningKey[]): Promise<void> => {
		if (keys.length === 0) return;
		const now = Date.now();
		const rows = keys.map((key) => ({
			syncWarningId: deriveSyncWarningId(
				key.accountId,
				key.mailboxId,
				key.uidValidity,
				key.uid,
				key.stage,
			),
			...key,
			attempts: 1,
			createdAt: now,
		}));
		await this.batch(
			chunkRows(syncWarningTable, rows, this.maxBoundParameters).map((slice) =>
				this.db
					.insert(syncWarningTable)
					.values(slice)
					.onConflictDoUpdate({
						target: syncWarningTable.syncWarningId,
						set: { attempts: sql`${syncWarningTable.attempts} + 1` },
					}),
			),
		);
	};

	deleteMany = async (syncWarningIds: string[]): Promise<void> => {
		if (syncWarningIds.length === 0) return;
		await this.db
			.delete(syncWarningTable)
			.where(inList(syncWarningTable.syncWarningId, syncWarningIds));
	};
}
