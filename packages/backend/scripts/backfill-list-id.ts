import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { logger } from "@remit/logger-lambda";
import {
	backfillListIds,
	type ListIdBackfillCheckpoint,
	type ListIdBackfillCheckpointStore,
} from "@remit/mailbox-service";
import { getClient } from "../src/service/data-client.js";

/**
 * One-time, full-corpus `ThreadMessage.listId` backfill (issue #263). Ships as
 * an alternate entrypoint baked into the backend image — "the backend image
 * with a command", the same shape `migrate.mjs` uses — rather than a service
 * of its own. Unlike `migrate`, it is never wired into a compose one-shot: a
 * full pass runs once per install, not on every restart. Invoke it by hand:
 *
 *   docker compose -f docker-compose.sqlite.yml run --rm backend \
 *     node backfill-list-id.mjs
 *
 * Safe to interrupt: progress is checkpointed to disk after every page and
 * picked back up on the next run, and every row it touches is read-only
 * against the stored message, so a rerun after a partial pass is a no-op for
 * everything already done.
 */

const CHECKPOINT_PATH =
	process.env.LIST_ID_BACKFILL_CHECKPOINT_PATH ??
	"/data/sqlite/list-id-backfill-checkpoint.json";

const fileCheckpointStore: ListIdBackfillCheckpointStore = {
	load: async () => {
		if (!existsSync(CHECKPOINT_PATH)) return undefined;
		const raw = await readFile(CHECKPOINT_PATH, "utf8");
		return JSON.parse(raw) as ListIdBackfillCheckpoint;
	},
	save: async (checkpoint) => {
		await mkdir(dirname(CHECKPOINT_PATH), { recursive: true });
		await writeFile(CHECKPOINT_PATH, JSON.stringify(checkpoint));
	},
	clear: async () => {
		await rm(CHECKPOINT_PATH, { force: true });
	},
};

const run = async (): Promise<void> => {
	const client = await getClient();

	const result = await backfillListIds(
		{
			accountConfigService: client.accountConfig,
			threadMessageService: client.threadMessage,
			messageService: client.message,
			storageService: client.storage,
		},
		{ checkpointStore: fileCheckpointStore, logger },
	);

	// biome-ignore lint/plugin/no-logger-info: a completed full-corpus backfill is an audit-grade signal
	logger.info({ result }, "backfill done");
};

run()
	.then(() => process.exit(0))
	.catch((error: unknown) => {
		logger.error({ error }, "backfill failed");
		process.exit(1);
	});
