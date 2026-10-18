import type {
	ISyncWarningRepository,
	SyncWarningItem,
	SyncWarningKey,
} from "@remit/data-ports";
import { deriveSyncWarningId } from "@remit/data-ports/id";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { syncWarningTable } from "../schema/sync-warning.js";

type DB = Db<Record<string, unknown>>;

export class SyncWarningRepo implements ISyncWarningRepository {
	constructor(private db: DB) {}

	listByMailboxId = async (mailboxId: string): Promise<SyncWarningItem[]> =>
		this.db
			.select()
			.from(syncWarningTable)
			.where(eq(syncWarningTable.mailboxId, mailboxId))
			.orderBy(asc(syncWarningTable.uid));

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
			.where(inArray(syncWarningTable.syncWarningId, syncWarningIds));
	};
}
