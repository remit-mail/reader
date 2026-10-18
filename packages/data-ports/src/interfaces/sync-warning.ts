import type { SyncWarningItem, SyncWarningKey } from "../types.js";

export interface SurfacedSyncWarnings {
	items: SyncWarningItem[];
	total: number;
}

export interface ISyncWarningRepository {
	listByMailboxId(mailboxId: string): Promise<SyncWarningItem[]>;

	listSurfacedByAccountConfigId(
		accountConfigId: string,
		minAttempts: number,
		limit: number,
	): Promise<SurfacedSyncWarnings>;

	recordFailures(keys: SyncWarningKey[]): Promise<void>;

	deleteMany(syncWarningIds: string[]): Promise<void>;
}
