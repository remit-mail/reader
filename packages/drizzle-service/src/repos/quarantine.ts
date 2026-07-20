import type {
	IQuarantineRepository,
	QuarantineItem,
	QuarantineMimeNodeItem,
} from "@remit/data-ports";
import { desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { quarantineTable } from "../schema/quarantine.js";

type DB = NodePgDatabase<Record<string, unknown>>;

function rowToItem(row: typeof quarantineTable.$inferSelect): QuarantineItem {
	return {
		quarantineId: row.quarantineId,
		accountConfigId: row.accountConfigId,
		accountId: row.accountId,
		mailboxId: row.mailboxId,
		uid: row.uid,
		mailboxRole: row.mailboxRole ?? undefined,
		mailboxPath: row.mailboxPath,
		quarantinedAt: row.quarantinedAt,
		attempts: row.attempts,
		failureStage: row.failureStage,
		failureCode: row.failureCode,
		failureMessage: row.failureMessage,
		failurePartPath: row.failurePartPath ?? undefined,
		workerVersion: row.workerVersion,
		contentType: row.contentType,
		transferEncoding: row.transferEncoding,
		charset: row.charset ?? undefined,
		sizeBytes: row.sizeBytes,
		structure: row.structure as QuarantineMimeNodeItem[],
		messageIdHash: row.messageIdHash,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * Read side of the message quarantine (issue #72). The rows are written by the
 * sync worker; nothing in the API process creates or clears one.
 */
export class QuarantineRepo implements IQuarantineRepository {
	constructor(private db: DB) {}

	listByAccountConfigId = async (
		accountConfigId: string,
	): Promise<QuarantineItem[]> => {
		const rows = await this.db
			.select()
			.from(quarantineTable)
			.where(eq(quarantineTable.accountConfigId, accountConfigId))
			.orderBy(desc(quarantineTable.quarantinedAt));
		return rows.map(rowToItem);
	};
}
