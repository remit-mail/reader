import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { logger } from "@remit/logger-lambda";
import {
	backfillClassifications,
	type ClassificationBackfillCheckpoint,
	type ClassificationBackfillCheckpointStore,
} from "@remit/mailbox-service";
import { getClient } from "../src/service/data-client.js";

/**
 * One-time, full-corpus classification backfill over the stored-body cohort
 * the classifier never examined (issue #1197): rows whose bodies were synced
 * before the classifier reached them, which carry `NotExamined` on
 * `Message.classificationState` and so stay `uncategorized` in the list. The
 * same alternate-entrypoint shape `backfill-list-id.mjs` uses: baked into the
 * backend image, never wired into a compose one-shot, run by hand once per
 * install:
 *
 *   docker compose -f docker-compose.sqlite.yml run --rm backend \
 *     node backfill-classification.mjs
 *
 * Safe to interrupt: progress is checkpointed to disk after every page and
 * picked back up on the next run, every already-examined row reads as
 * `alreadyExamined` on a rerun, and a row whose category was already decided
 * is recorded without re-deriving it, so a partial pass resumes rather than
 * repeats.
 */

const CHECKPOINT_PATH =
	process.env.CLASSIFICATION_BACKFILL_CHECKPOINT_PATH ??
	"/data/sqlite/classification-backfill-checkpoint.json";

const isCheckpoint = (
	value: unknown,
): value is ClassificationBackfillCheckpoint => {
	if (typeof value !== "object" || value === null) return false;
	if (!("accountConfigId" in value)) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.accountConfigId === "string" &&
		(candidate.continuationToken === undefined ||
			typeof candidate.continuationToken === "string")
	);
};

const fileCheckpointStore: ClassificationBackfillCheckpointStore = {
	load: async () => {
		if (!existsSync(CHECKPOINT_PATH)) return undefined;
		const raw = await readFile(CHECKPOINT_PATH, "utf8");
		const parsed: unknown = JSON.parse(raw);
		return isCheckpoint(parsed) ? parsed : undefined;
	},
	save: async (checkpoint) => {
		await mkdir(dirname(CHECKPOINT_PATH), { recursive: true });
		const staging = `${CHECKPOINT_PATH}.writing`;
		await writeFile(staging, JSON.stringify(checkpoint));
		await rename(staging, CHECKPOINT_PATH);
	},
	clear: async () => {
		await rm(CHECKPOINT_PATH, { force: true });
	},
};

const run = async (): Promise<void> => {
	const client = await getClient();

	const result = await backfillClassifications(
		{
			accountConfigService: client.accountConfig,
			addressService: client.address,
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
