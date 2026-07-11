import type { Logger } from "@remit/logger-lambda";
import pMap from "p-map";
import type { Pool } from "pg";
import { type IndexOutcome, upsertMessage } from "./handler.js";
import type { Services } from "./services.js";

export interface ReindexResult {
	total: number;
	indexed: number;
	skipped: number;
}

const NOT_APPLICABLE_ACCOUNT_ID = "reindex-all";

/**
 * Re-embed every body-synced Postgres message. Concurrent (pMap) and
 * force-upserting so a model change or a repair repopulates the whole store;
 * keys-only scan keeps the hot path off `describe()`. Postgres-only — the
 * `accountId` on the synthetic upsert message is a placeholder: `services`
 * must carry `resolveAccountId` (true whenever `DATA_BACKEND=postgres`; see
 * `data-ports.ts`), which derives the real one from each message's mailbox.
 */
export const reindexAll = async (
	pool: Pool,
	services: Services,
	log: Logger,
	options?: { concurrency?: number },
): Promise<ReindexResult> => {
	const rows = await pool.query<{ message_id: string }>(
		"SELECT message_id FROM message WHERE body_storage_key IS NOT NULL",
	);
	const messageIds = rows.rows.map((row) => row.message_id);

	let indexed = 0;
	let skipped = 0;
	await pMap(
		messageIds,
		async (messageId) => {
			let outcome: IndexOutcome | undefined;
			const taskServices: Services = {
				...services,
				onIndexOutcome: (o) => {
					outcome = o;
				},
			};
			await upsertMessage(
				{
					kind: "upsert",
					accountId: NOT_APPLICABLE_ACCOUNT_ID,
					messageId,
					force: true,
				},
				taskServices,
				log,
			);
			if (outcome?.status === "indexed") indexed += 1;
			else skipped += 1;
		},
		{ concurrency: options?.concurrency ?? 8 },
	);

	return { total: messageIds.length, indexed, skipped };
};
