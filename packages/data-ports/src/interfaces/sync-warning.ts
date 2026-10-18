import type { SyncWarningItem, SyncWarningKey } from "../types.js";

export interface ISyncWarningRepository {
	listByMailboxId(mailboxId: string): Promise<SyncWarningItem[]>;

	recordFailures(keys: SyncWarningKey[]): Promise<void>;

	deleteMany(syncWarningIds: string[]): Promise<void>;
}
