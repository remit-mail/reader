import type {
	IQuarantineRepository,
	QuarantineItem,
	QuarantineMimeNodeItem,
	QuarantineUpsertInput,
} from "@remit/data-ports";
import { deriveQuarantineId } from "@remit/data-ports/id";
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
		uidValidity: row.uidValidity,
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
		contentType: row.contentType ?? undefined,
		transferEncoding: row.transferEncoding ?? undefined,
		charset: row.charset ?? undefined,
		sizeBytes: row.sizeBytes ?? undefined,
		structure: row.structure as QuarantineMimeNodeItem[],
		messageIdHash: row.messageIdHash ?? undefined,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * The message quarantine (issue #72). Written by the sync worker, read by the
 * settings surface; nothing in the API process creates or clears a row.
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

	upsert = async (input: QuarantineUpsertInput): Promise<void> => {
		const quarantineId = deriveQuarantineId(
			input.accountId,
			input.mailboxId,
			input.uidValidity,
			input.uid,
		);
		const now = Date.now();
		const columns = {
			accountConfigId: input.accountConfigId,
			accountId: input.accountId,
			mailboxId: input.mailboxId,
			uidValidity: input.uidValidity,
			uid: input.uid,
			mailboxRole: input.mailboxRole ?? null,
			mailboxPath: input.mailboxPath,
			quarantinedAt: input.quarantinedAt,
			attempts: input.attempts,
			failureStage: input.failureStage,
			failureCode: input.failureCode,
			failureMessage: input.failureMessage,
			failurePartPath: input.failurePartPath ?? null,
			workerVersion: input.workerVersion,
			contentType: input.contentType ?? null,
			transferEncoding: input.transferEncoding ?? null,
			charset: input.charset ?? null,
			sizeBytes: input.sizeBytes ?? null,
			structure: input.structure ?? [],
			messageIdHash: input.messageIdHash ?? null,
		};

		// `quarantinedAt` is deliberately part of the update set: a re-quarantine
		// is the message being set aside again, and the list is ordered by it.
		// `createdAt` is not, so the row keeps saying when the message first
		// failed.
		await this.db
			.insert(quarantineTable)
			.values({ quarantineId, ...columns, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: quarantineTable.quarantineId,
				set: { ...columns, updatedAt: now },
			});
	};
}
