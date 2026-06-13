import { inspect } from "node:util";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { NotFoundError } from "@remit/remit-electrodb-service";
import { createLogger, type Logger } from "@remit/logger-lambda";
import type { Context, SQSEvent, SQSHandler } from "aws-lambda";
import {
	type CascadeEntity,
	type CascadeServices,
	enumerateAccountPurgeChunk,
	enumerateCascadeEntities,
} from "../cascade.js";
import {
	type CascadeS3Client,
	deleteS3Prefix,
	runDdbCascadeDelete,
} from "../cascade-delete.js";
import {
	type InvalidationClient,
	invalidateAccountContent,
} from "../cloudfront-invalidation.js";
import {
	cascadeServices as defaultCascadeServices,
	ddbClient as defaultDdbClient,
	sqsClient as defaultSqsClient,
	tableName as defaultTableName,
	getAccountFinalizeQueueUrl,
} from "../config.js";
import type {
	AccountDataPurgeFinalizeEvent,
	AccountDeleteFinalizeEvent,
	AccountFinalizeEvent,
} from "../events.js";

let _cloudFrontClient: CloudFrontClient | undefined;
const getCloudFrontClient = (): CloudFrontClient => {
	if (!_cloudFrontClient) _cloudFrontClient = new CloudFrontClient({});
	return _cloudFrontClient;
};

let _s3Client: S3Client | undefined;
const getS3Client = (): S3Client => {
	if (!_s3Client) _s3Client = new S3Client({});
	return _s3Client;
};

/**
 * S3 client surface used by the finalize cascade. Re-exported alias of the
 * shared {@link CascadeS3Client} so existing importers keep working.
 */
export type FinalizeS3Client = CascadeS3Client;

export interface ProcessFinalizeDeps {
	cloudFrontClient?: InvalidationClient;
	distributionId?: string;
	s3Client?: FinalizeS3Client;
	storageBucket?: string;
	cascadeServices?: CascadeServices;
	ddbClient?: typeof defaultDdbClient;
	tableName?: string;
	sqs?: SQSClient;
	accountFinalizeQueueUrl?: string;
	purgeChunkSize?: number;
}

/**
 * Message subtrees deleted per finalize invocation. Bounded so one Lambda
 * always stays well within its timeout and DDB throughput on a real-sized
 * account (~8.7k messages × child entities): a chunk is at most
 * `PURGE_CHUNK_SIZE` `describe()` collection reads plus the resulting batched
 * deletes, then a continuation is re-enqueued. The full account is drained
 * across as many invocations as needed instead of a single all-or-nothing run.
 */
export const PURGE_CHUNK_SIZE = 250;

/**
 * GDPR hard-delete: every row tied to the deleted AccountConfig is removed
 * from DDB and every object under `accounts/{accountConfigId}/` is removed
 * from S3. The AccountConfig row itself is the LAST DDB delete so that a
 * mid-cascade replay still sees the cascade-in-progress flag (`deletedAt`
 * set, `isActive=false`, written API-side) and re-runs cleanly. After a
 * successful run nothing tied to the AccountConfig persists.
 *
 * Step order (non-negotiable per #320):
 *   1. CloudFront invalidation — runs FIRST so cached body parts cannot
 *      leak after the underlying S3 objects are gone.
 *   2. DDB cascade delete in dependency order (children → parents).
 *   3. S3 prefix cleanup `accounts/{accountConfigId}/`.
 *   4. AccountConfig delete.
 *
 * Idempotency: every step is replay-safe. DDB BatchWriteItem on a missing
 * key is a 200, S3 DeleteObjects on missing keys is a 200, CloudFront
 * CreateInvalidation always succeeds (extra invalidations only cost money).
 * No explicit "already deleted" pre-checks — they make replays racier, not
 * safer. Errors propagate so SQS retries the message; eventually the DLQ
 * alarm `remit-{stage}-account-finalize-dlq-not-empty` fires and an
 * operator inspects the failure.
 */
export const processAccountFinalize = async (
	event: AccountDeleteFinalizeEvent,
	log: Logger,
	deps: ProcessFinalizeDeps = {},
): Promise<void> => {
	const { accountConfigId } = event;
	const distributionId =
		deps.distributionId ?? process.env.CONTENT_DISTRIBUTION_ID ?? "";
	const cloudFrontClient = deps.cloudFrontClient ?? getCloudFrontClient();
	const s3Client = deps.s3Client ?? getS3Client();
	const storageBucket =
		deps.storageBucket ?? process.env.S3_STORAGE_BUCKET_NAME ?? "";
	const services = deps.cascadeServices ?? defaultCascadeServices;
	const ddbClient = deps.ddbClient ?? defaultDdbClient;
	const tableName = deps.tableName ?? defaultTableName;

	// Fail-loud env validation up front, symmetric for both vars.
	if (!distributionId) {
		throw new Error(
			"CONTENT_DISTRIBUTION_ID is not set; cannot invalidate CloudFront cache",
		);
	}
	if (!storageBucket) {
		throw new Error(
			"S3_STORAGE_BUCKET_NAME is not set; cannot purge account S3 objects",
		);
	}

	// Step 1: CloudFront invalidation — first, so cached body parts cannot
	// leak after the underlying S3 objects are gone.
	log.info(
		{ accountConfigId },
		"Invalidating CloudFront cache for erased account",
	);
	await invalidateAccountContent(
		accountConfigId,
		distributionId,
		cloudFrontClient,
	);
	log.info({ accountConfigId }, "CloudFront invalidation submitted");

	// Step 2: DDB cascade delete (children → parents). The AccountConfig
	// row is excluded from the cascade plan and removed last, after S3.
	//
	// SQS is at-least-once: a successful cascade can be redelivered. After
	// a clean run the AccountConfig row is gone, so `describe()` throws
	// `NotFoundError` — that's the success signal, not a failure. Treat
	// it as "cascade already complete" and return cleanly. Any other
	// error propagates so SQS retries → DLQ. Symmetric with the fanout
	// worker's `UserNotFoundException` handling for already-gone Cognito
	// users (`account-fanout.ts`).
	let entities: CascadeEntity[];
	try {
		const enumeration = await enumerateCascadeEntities(
			accountConfigId,
			services,
			log,
		);
		entities = enumeration.entities;
	} catch (error) {
		if (error instanceof NotFoundError) {
			log.info(
				{ accountConfigId },
				"Cascade already complete (AccountConfig not found on replay) — no-op",
			);
			return;
		}
		throw error;
	}
	const cascadeEntities = entities.filter(
		(e) => e.entityType !== "AccountConfig",
	);
	await runDdbCascadeDelete(
		cascadeEntities,
		{ client: ddbClient, table: tableName },
		log,
	);

	// Step 3: S3 prefix cleanup. Runs AFTER DDB so a mid-cascade replay
	// always re-runs the (idempotent) S3 step.
	await deleteS3Prefix(
		storageBucket,
		`accounts/${accountConfigId}/`,
		s3Client,
		log,
	);

	// Step 4: AccountConfig delete — the last write. The presence of an
	// AccountConfig row with `deletedAt` set is the cascade-in-progress
	// flag; removing the row is the only signal the cascade fully finished.
	await services.accountConfigService.delete(accountConfigId);
	log.info({ accountConfigId }, "AccountConfig deleted; cascade complete");
};

/**
 * Destructive phase of the per-account purge. Deletes ONE account's rows
 * (children → parents), the S3 objects under `accounts/{cfg}/{acct}/`, and
 * invalidates that account's CloudFront content — keeping the AccountConfig,
 * its sibling accounts, and the soft-deleted account row intact.
 *
 * Chunk-resumable: a single Lambda invocation deletes at most
 * {@link PURGE_CHUNK_SIZE} message subtrees, then — if the account still holds
 * messages — re-enqueues a continuation `FinalizeAccountDataPurge` and returns.
 * A real-sized account (~8.7k messages × child entities) drains across several
 * invocations instead of one all-or-nothing run that timed out and parked in
 * the finalize DLQ. The CloudFront invalidation and S3 prefix cleanup run only
 * on the FINAL (draining) chunk: invalidate-before-S3, S3-after-DDB.
 *
 * Runs in the finalize worker so it reuses the S3-delete, CloudFront, and DDB
 * batch-write grants already on that Lambda — no new infrastructure or IAM.
 *
 * Vector deletes are NOT issued here: the fanout step already enqueues a
 * search-index REMOVE for every message id up front
 * (`account-purge.ts` → `enqueueVectorDeletes`), so re-enqueuing per chunk
 * would double-delete. Finalize deletes only DDB rows + S3 objects.
 *
 * Idempotency: deletes drain the mailboxes from the front, so a replayed chunk
 * re-deletes already-gone rows (DDB BatchWriteItem on a missing key is a 200)
 * and re-queries whatever remains. A `NotFoundError` (account row removed out
 * of band) is the already-purged signal — no-op. Termination: every non-final
 * chunk strictly reduces the message count by `PURGE_CHUNK_SIZE`, so the drain
 * is monotone and stops once the account is empty.
 */
export const processAccountDataPurgeFinalize = async (
	event: AccountDataPurgeFinalizeEvent,
	log: Logger,
	deps: ProcessFinalizeDeps = {},
): Promise<void> => {
	const { accountId, accountConfigId } = event;
	const distributionId =
		deps.distributionId ?? process.env.CONTENT_DISTRIBUTION_ID ?? "";
	const cloudFrontClient = deps.cloudFrontClient ?? getCloudFrontClient();
	const s3Client = deps.s3Client ?? getS3Client();
	const storageBucket =
		deps.storageBucket ?? process.env.S3_STORAGE_BUCKET_NAME ?? "";
	const services = deps.cascadeServices ?? defaultCascadeServices;
	const ddbClient = deps.ddbClient ?? defaultDdbClient;
	const tableName = deps.tableName ?? defaultTableName;
	const sqs = deps.sqs ?? defaultSqsClient;
	const purgeChunkSize = deps.purgeChunkSize ?? PURGE_CHUNK_SIZE;
	const chunk = event.chunk ?? 0;

	if (!distributionId) {
		throw new Error(
			"CONTENT_DISTRIBUTION_ID is not set; cannot invalidate CloudFront cache",
		);
	}
	if (!storageBucket) {
		throw new Error(
			"S3_STORAGE_BUCKET_NAME is not set; cannot purge account S3 objects",
		);
	}

	// "Already purged" is signalled ONLY by the absence of the account row
	// itself — probed explicitly here. A NotFoundError from anywhere deeper in
	// the chunk enumeration (e.g. a stale-GSI per-message read) must NOT be read
	// as "account gone, no-op": that would silently abandon the drain with
	// orphaned mailboxes/threads/outbox/locks/S3 surviving. Such errors are
	// either handled inside the enumerator (stale message subtree → skip) or
	// propagate as genuine failures so SQS retries.
	try {
		await services.accountService.get(accountId);
	} catch (error) {
		if (error instanceof NotFoundError) {
			log.info(
				{ accountConfigId, accountId },
				"Per-account purge already complete (account row gone) — no-op",
			);
			return;
		}
		throw error;
	}

	const plan = await enumerateAccountPurgeChunk(
		accountConfigId,
		accountId,
		purgeChunkSize,
		services,
		log,
	);
	const entities: CascadeEntity[] = plan.entities;
	const drained: boolean = plan.drained;

	// Non-final chunk: delete this slice of message subtrees and hand off to a
	// continuation. CloudFront/S3 cleanup is deferred to the final chunk so the
	// invalidate-before-S3, S3-after-DDB ordering still holds end-to-end.
	if (!drained) {
		await runDdbCascadeDelete(
			entities,
			{ client: ddbClient, table: tableName },
			log,
		);
		const next: AccountDataPurgeFinalizeEvent = {
			type: "FinalizeAccountDataPurge",
			accountId,
			accountConfigId,
			chunk: chunk + 1,
		};
		await sqs.send(
			new SendMessageCommand({
				QueueUrl: deps.accountFinalizeQueueUrl ?? getAccountFinalizeQueueUrl(),
				MessageBody: JSON.stringify(next),
			}),
		);
		log.info(
			{ accountConfigId, accountId, chunk, nextChunk: chunk + 1 },
			"Per-account purge chunk deleted; continuation enqueued",
		);
		return;
	}

	// Final chunk — the account holds no more messages. Step 1: CloudFront
	// invalidation for this account's content prefix only.
	log.info(
		{ accountConfigId, accountId, chunk },
		"Invalidating CloudFront cache for purged account (final chunk)",
	);
	await invalidateAccountContent(
		`${accountConfigId}/${accountId}`,
		distributionId,
		cloudFrontClient,
	);

	// Step 2: DDB cascade delete (children → parents) for the last slice of
	// messages plus the container rows (mailboxes, thread messages, outbox,
	// locks). The Account row is not in the plan; it is kept as the
	// purge-in-progress marker.
	await runDdbCascadeDelete(
		entities,
		{ client: ddbClient, table: tableName },
		log,
	);

	// Step 3: S3 prefix cleanup scoped to this account only.
	await deleteS3Prefix(
		storageBucket,
		`accounts/${accountConfigId}/${accountId}/`,
		s3Client,
		log,
	);

	log.info(
		{ accountConfigId, accountId, chunk },
		"Per-account data purge complete",
	);
};

// ---------- SQS handler ----------

export const handler: SQSHandler = async (
	event: SQSEvent,
	context: Context,
) => {
	const log = createLogger(context);
	const batchItemFailures: { itemIdentifier: string }[] = [];

	for (const record of event.Records) {
		try {
			const finalizeEvent: AccountFinalizeEvent = JSON.parse(record.body);
			log.info(
				{
					eventType: finalizeEvent.type,
					accountConfigId: finalizeEvent.accountConfigId,
				},
				"Processing account finalize event",
			);
			if (finalizeEvent.type === "FinalizeAccountDataPurge") {
				await processAccountDataPurgeFinalize(finalizeEvent, log);
			} else {
				await processAccountFinalize(finalizeEvent, log);
			}
		} catch (error) {
			log.error(
				{ error: inspect(error), messageId: record.messageId },
				"Account finalize event processing failed",
			);
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	return { batchItemFailures };
};

export const finalizeHandler: SQSHandler = handler;
