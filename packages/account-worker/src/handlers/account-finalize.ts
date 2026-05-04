import { inspect } from "node:util";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import {
	DeleteObjectsCommand,
	ListObjectsV2Command,
	S3Client,
} from "@aws-sdk/client-s3";
import {
	Account,
	AccountConfig,
	Address,
	BodyPart,
	BodyPartContent,
	BodyPartParameter,
	BodyPartStorage,
	Envelope,
	EnvelopeAddress,
	Mailbox,
	MailboxLock,
	Message,
	MessageFlag,
	MessageReference,
	OutboxMessage,
	RawMessageStorage,
	ThreadMessage,
} from "@remit/electrodb-entities";
import { NotFoundError } from "@remit/remit-electrodb-service";
import { createLogger, type Logger } from "@remit/logger-lambda";
import type { Context, SQSEvent, SQSHandler } from "aws-lambda";
import { Entity } from "electrodb";
import {
	type CascadeEntity,
	type CascadeServices,
	enumerateCascadeEntities,
} from "../cascade.js";
import {
	type InvalidationClient,
	invalidateAccountContent,
} from "../cloudfront-invalidation.js";
import {
	cascadeServices as defaultCascadeServices,
	ddbClient as defaultDdbClient,
	tableName as defaultTableName,
} from "../config.js";
import type { AccountFinalizeEvent } from "../events.js";

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
 * S3 client surface used by the finalize cascade. Subset of the SDK
 * `S3Client` so tests can swap in an `aws-sdk-client-mock` instance or a
 * hand-rolled fake without pulling in the full client.
 */
export interface FinalizeS3Client {
	send(command: ListObjectsV2Command): Promise<{
		Contents?: Array<{ Key?: string }>;
		IsTruncated?: boolean;
		NextContinuationToken?: string;
	}>;
	send(command: DeleteObjectsCommand): Promise<unknown>;
}

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
	event: AccountFinalizeEvent,
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

// ---------- DDB cascade ----------

// DDB `BatchWriteItem` accepts up to 25 requests per call.
const DDB_BATCH_LIMIT = 25;
// Bounded retry on `UnprocessedItems` — exponential backoff, jittered.
const DDB_MAX_RETRIES = 5;

// biome-ignore lint/suspicious/noExplicitAny: ElectroDB's Entity generics
// are not parameterisable across heterogeneous schemas in a single map; the
// schemas below are all valid Entity inputs and the wrapping at use-site
// keeps the rest of the file fully typed.
const ENTITY_BY_TYPE: Record<string, any> = {
	Account,
	AccountConfig,
	Address,
	BodyPart,
	BodyPartContent,
	BodyPartParameter,
	BodyPartStorage,
	Envelope,
	EnvelopeAddress,
	Mailbox,
	MailboxLock,
	Message,
	MessageFlag,
	MessageReference,
	OutboxMessage,
	RawMessageStorage,
	ThreadMessage,
};

// Children-first delete order. AccountConfig is intentionally absent — it
// is removed last by the caller, after S3 cleanup, so a mid-cascade replay
// always re-enters and finishes.
const DELETE_LEVELS: readonly (readonly string[])[] = [
	["MessageFlag", "MessageReference"],
	[
		"BodyPartParameter",
		"BodyPartStorage",
		"BodyPartContent",
		"RawMessageStorage",
	],
	["BodyPart"],
	["EnvelopeAddress"],
	["Envelope"],
	["ThreadMessage"],
	["Message"],
	["OutboxMessage"],
	["Mailbox"],
	["MailboxLock"],
	["Address", "Account"],
];

const sleep = (ms: number): Promise<void> =>
	new Promise((r) => setTimeout(r, ms));

interface DdbConfig {
	client: typeof defaultDdbClient;
	table: string;
}

const runDdbCascadeDelete = async (
	entities: CascadeEntity[],
	config: DdbConfig,
	log: Logger,
): Promise<void> => {
	const grouped = new Map<string, Record<string, string>[]>();
	for (const entity of entities) {
		const list = grouped.get(entity.entityType) ?? [];
		list.push(entity.key);
		grouped.set(entity.entityType, list);
	}

	for (const level of DELETE_LEVELS) {
		for (const entityType of level) {
			const keys = grouped.get(entityType);
			if (!keys || keys.length === 0) continue;
			await deleteEntityBatch(entityType, keys, config, log);
		}
	}
};

const deleteEntityBatch = async (
	entityType: string,
	keys: Record<string, string>[],
	config: DdbConfig,
	log: Logger,
): Promise<void> => {
	const schema = ENTITY_BY_TYPE[entityType];
	if (!schema) {
		throw new Error(`Unknown entity type in cascade: ${entityType}`);
	}

	const entity = new Entity(schema, {
		client: config.client,
		table: config.table,
	}) as unknown as {
		delete: (keys: Record<string, string>[]) => {
			go: () => Promise<{ unprocessed: Record<string, string>[] }>;
		};
	};

	for (let i = 0; i < keys.length; i += DDB_BATCH_LIMIT) {
		const chunk = keys.slice(i, i + DDB_BATCH_LIMIT);
		let pending: Record<string, string>[] = chunk;
		for (let attempt = 0; attempt <= DDB_MAX_RETRIES; attempt++) {
			const result = await entity.delete(pending).go();
			const unprocessed = result.unprocessed ?? [];
			if (unprocessed.length === 0) break;
			if (attempt === DDB_MAX_RETRIES) {
				throw new Error(
					`BatchWriteItem still has ${unprocessed.length} unprocessed ${entityType} items after ${DDB_MAX_RETRIES} retries`,
				);
			}
			// Exponential backoff with jitter (50ms, 100ms, 200ms, 400ms, 800ms).
			const backoff = 50 * 2 ** attempt + Math.floor(Math.random() * 50);
			log.warn(
				{
					entityType,
					unprocessed: unprocessed.length,
					attempt,
					backoffMs: backoff,
				},
				"BatchWriteItem returned UnprocessedItems; retrying",
			);
			await sleep(backoff);
			pending = unprocessed;
		}
	}

	log.info({ entityType, count: keys.length }, "DDB cascade level complete");
};

// ---------- S3 cascade ----------

// `DeleteObjects` accepts up to 1000 keys per call.
const S3_DELETE_LIMIT = 1000;

const deleteS3Prefix = async (
	bucket: string,
	prefix: string,
	client: FinalizeS3Client,
	log: Logger,
): Promise<void> => {
	let continuationToken: string | undefined;
	let totalDeleted = 0;

	while (true) {
		const listResult = await client.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: prefix,
				MaxKeys: S3_DELETE_LIMIT,
				ContinuationToken: continuationToken,
			}),
		);
		const keys = (listResult.Contents ?? [])
			.map((o) => o.Key)
			.filter((k): k is string => typeof k === "string" && k.length > 0);

		if (keys.length > 0) {
			await client.send(
				new DeleteObjectsCommand({
					Bucket: bucket,
					Delete: {
						Objects: keys.map((Key) => ({ Key })),
						Quiet: true,
					},
				}),
			);
			totalDeleted += keys.length;
		}

		if (!listResult.IsTruncated) break;
		continuationToken = listResult.NextContinuationToken;
	}

	log.info({ bucket, prefix, totalDeleted }, "S3 prefix cleanup complete");
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
			await processAccountFinalize(finalizeEvent, log);
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
