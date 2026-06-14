import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
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
import type { Logger } from "@remit/logger-lambda";
import { Entity } from "electrodb";
import type { CascadeEntity } from "./cascade.js";
import type { ddbClient as defaultDdbClient } from "./config.js";

/**
 * S3 client surface used by the cascade. Subset of the SDK `S3Client` so tests
 * can swap in an `aws-sdk-client-mock` instance or a hand-rolled fake without
 * pulling in the full client.
 */
export interface CascadeS3Client {
	send(command: ListObjectsV2Command): Promise<{
		Contents?: Array<{ Key?: string }>;
		IsTruncated?: boolean;
		NextContinuationToken?: string;
	}>;
	send(command: DeleteObjectsCommand): Promise<unknown>;
}

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

/**
 * Children-first delete order. AccountConfig and Account are intentionally
 * absent — the tenant cascade removes the AccountConfig last (after S3), and
 * the per-account purge keeps the (soft-deleted) Account row as its
 * purge-in-progress marker. Any caller that needs to delete those rows does so
 * explicitly, outside this ordering.
 */
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

export interface DdbConfig {
	client: typeof defaultDdbClient;
	table: string;
}

/**
 * Deletes the enumerated rows in dependency order (children → parents).
 * Replay-safe: DynamoDB `BatchWriteItem` on an already-missing key is a 200,
 * so a redelivered cascade no-ops cleanly.
 */
export const runDdbCascadeDelete = async (
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

// `DeleteObjects` accepts up to 1000 keys per call.
const S3_DELETE_LIMIT = 1000;

/**
 * Deletes every object under `prefix`. Replay-safe: `DeleteObjects` on missing
 * keys is a 200.
 */
export const deleteS3Prefix = async (
	bucket: string,
	prefix: string,
	client: CascadeS3Client,
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
