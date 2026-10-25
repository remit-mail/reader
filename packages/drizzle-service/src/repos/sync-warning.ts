import type {
	ISyncWarningRepository,
	SurfacedSyncWarnings,
	SyncWarningItem,
	SyncWarningKey,
} from "@remit/data-ports";
import { deriveSyncWarningId } from "@remit/data-ports/id";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { syncWarningTable } from "../schema/sync-warning.js";
import { inList } from "./in-list.js";

type DB = Db<Record<string, unknown>>;

export class SyncWarningRepo implements ISyncWarningRepository {
	constructor(private db: DB) {}

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
		await this.db
			.insert(syncWarningTable)
			.values(
				keys.map((key) => ({
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
				})),
			)
			.onConflictDoUpdate({
				target: syncWarningTable.syncWarningId,
				set: { attempts: sql`${syncWarningTable.attempts} + 1` },
			});
	};

	deleteMany = async (syncWarningIds: string[]): Promise<void> => {
		if (syncWarningIds.length === 0) return;
		await this.db
			.delete(syncWarningTable)
			.where(inList(syncWarningTable.syncWarningId, syncWarningIds));
	};
}
