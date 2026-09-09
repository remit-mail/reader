import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AddressItem, SenderSignerStandingItem } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { deriveAddressId } from "@remit/data-ports/id";
import { logger } from "@remit/logger-lambda";
import {
	backfillClassifications,
	type ClassificationBackfillCheckpoint,
	type ClassificationBackfillCheckpointStore,
	deriveStandingPair,
	extractPrimaryFromEmail,
	resolveAuthenticityVerdict,
} from "@remit/mailbox-service";
import { getClient } from "../src/service/data-client.js";

/**
 * One-time, full-corpus `Message.authenticityVerdict` backfill over the
 * stored-body cohort the derivation has never run on (issue #1197). The same
 * alternate-entrypoint shape `backfill-list-id.mjs` uses: baked into the
 * backend image, never wired into a compose one-shot, run by hand once per
 * install:
 *
 *   docker compose -f docker-compose.sqlite.yml run --rm backend \
 *     node backfill-classification.mjs
 *
 * Safe to interrupt: progress is checkpointed to disk after every page and
 * picked back up on the next run, and every already-derived row reads as
 * `alreadySet` on a rerun, so a partial pass resumes rather than repeats.
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

/**
 * The standing of one `(senderKey, signerDomain)` pair: the repository's `get`
 * succeeds when the key has been observed before and throws its not-found
 * error when it has not — only that error means "no standing"; anything else
 * (throttle, infra) propagates rather than quietly demoting a known sender to
 * `Caution`.
 */
const standingFor = async (
	client: Awaited<ReturnType<typeof getClient>>,
	accountConfigId: string,
	senderKey: string,
	signerDomain: string,
): Promise<SenderSignerStandingItem | null> => {
	try {
		return await client.senderSignerStanding.get(
			accountConfigId,
			senderKey,
			signerDomain,
		);
	} catch (error) {
		if (!(error instanceof NotFoundError)) throw error;
		return null;
	}
};

const run = async (): Promise<void> => {
	const client = await getClient();

	const result = await backfillClassifications(
		{
			accountConfigService: client.accountConfig,
			threadMessageService: client.threadMessage,
			messageService: client.message,
			storageService: client.storage,
			authenticityService: {
				resolveVerdict: async (accountConfigId, parsed) => {
					const pair = deriveStandingPair(parsed);
					const standing =
						pair === null
							? null
							: await standingFor(
									client,
									accountConfigId,
									pair.senderKey,
									pair.signerDomain,
								);

					// The sender's address flags, when the From address has an Address
					// row: the `trusted` flag is the user's outright say, which earns
					// quiet treatment the same way earned pair standing does. A
					// genuinely-absent Address is "no flags"; any other failure
					// propagates for the same reason `standingFor`'s does.
					const fromEmail = extractPrimaryFromEmail(parsed);
					let flags: AddressItem["flags"] | undefined;
					if (fromEmail !== null) {
						try {
							const address = await client.address.getAddress(
								accountConfigId,
								deriveAddressId(accountConfigId, fromEmail),
							);
							flags = address.flags;
						} catch (error) {
							if (!(error instanceof NotFoundError)) throw error;
						}
					}

					return resolveAuthenticityVerdict(parsed, standing, flags);
				},
				observeStanding: async (accountConfigId, parsed) => {
					const pair = deriveStandingPair(parsed);
					if (pair === null) return;
					await client.senderSignerStanding.observe({
						accountConfigId,
						senderKey: pair.senderKey,
						signerDomain: pair.signerDomain,
						// The arrival's own time, not the backfill's clock: this is a
						// replay of a batch that already happened, and the pair's age
						// should read from when the mail actually arrived.
						observedAt: parsed.date?.getTime() ?? Date.now(),
					});
				},
			},
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
