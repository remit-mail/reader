import { inspect } from "node:util";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { S3Client } from "@aws-sdk/client-s3";
import { NotFoundError } from "@remit/remit-electrodb-service";
import { createLogger, type Logger } from "@remit/logger-lambda";
import type { Context, SQSEvent, SQSHandler } from "aws-lambda";
import {
	type CascadeEntity,
	type CascadeServices,
	enumerateAccountPurgeEntities,
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
	tableName as defaultTableName,
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
}

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
 * Runs in the finalize worker so it reuses the S3-delete, CloudFront, and DDB
 * batch-write grants already on that Lambda — no new infrastructure or IAM.
 * Vector deletes are handled upstream by the fanout step (search-index queue).
 *
 * Idempotency: a redelivery after the account's rows are gone enumerates an
 * empty plan and re-issues idempotent S3/CloudFront calls. A `NotFoundError`
 * (account row removed out of band) is the already-purged signal — no-op.
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

	let entities: CascadeEntity[];
	try {
		const plan = await enumerateAccountPurgeEntities(
			accountConfigId,
			accountId,
			services,
			log,
		);
		entities = plan.entities;
	} catch (error) {
		if (error instanceof NotFoundError) {
			log.info(
				{ accountConfigId, accountId },
				"Per-account purge already complete (account not found on replay) — no-op",
			);
			return;
		}
		throw error;
	}

	// Step 1: CloudFront invalidation for this account's content prefix only.
	log.info(
		{ accountConfigId, accountId },
		"Invalidating CloudFront cache for purged account",
	);
	await invalidateAccountContent(
		`${accountConfigId}/${accountId}`,
		distributionId,
		cloudFrontClient,
	);

	// Step 2: DDB cascade delete (children → parents). The Account row is not
	// in the plan; it is kept as the purge-in-progress marker.
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

	log.info({ accountConfigId, accountId }, "Per-account data purge complete");
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
