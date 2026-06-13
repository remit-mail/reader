import { randomUUID } from "node:crypto";
import {
	SendMessageBatchCommand,
	SendMessageCommand,
	type SQSClient,
} from "@aws-sdk/client-sqs";
import { Message } from "@remit/electrodb-entities";
import { NotFoundError } from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import type { SearchIndexMessage } from "@remit/search-index-worker";
import { Entity } from "electrodb";
import {
	type CascadeServices,
	enumerateAccountPurgeMessageIds,
} from "../cascade.js";
import {
	cascadeServices as defaultCascadeServices,
	sqsClient as defaultSqsClient,
	getAccountFinalizeQueueUrl,
	getSearchIndexQueueUrl,
} from "../config.js";
import type {
	AccountDataPurgeEvent,
	AccountDataPurgeFinalizeEvent,
} from "../events.js";

export interface ProcessPurgeFanoutDeps {
	services?: CascadeServices;
	sqs?: SQSClient;
	accountFinalizeQueueUrl?: string;
	searchIndexQueueUrl?: string;
}

const SQS_BATCH_SIZE = 10;

const messageEntity = new Entity(Message, { table: "purge-keys" });

const messageKeys = (messageId: string): { pk: string; sk: string } => {
	const { Key } = messageEntity.delete({ messageId }).params<{
		Key: { pk: string; sk: string };
	}>();
	return Key;
};

const buildVectorDeleteEvent = (
	accountId: string,
	messageId: string,
): SearchIndexMessage => ({
	eventName: "REMOVE",
	entity: "Message",
	eventID: randomUUID(),
	eventTimestamp: Date.now(),
	accountId,
	keys: messageKeys(messageId),
	messageId,
});

const enqueueVectorDeletes = async (
	sqs: SQSClient,
	queueUrl: string,
	accountId: string,
	messageIds: string[],
): Promise<void> => {
	for (let i = 0; i < messageIds.length; i += SQS_BATCH_SIZE) {
		const batch = messageIds.slice(i, i + SQS_BATCH_SIZE);
		const result = await sqs.send(
			new SendMessageBatchCommand({
				QueueUrl: queueUrl,
				Entries: batch.map((messageId, idx) => ({
					Id: `${i + idx}`,
					MessageBody: JSON.stringify(
						buildVectorDeleteEvent(accountId, messageId),
					),
				})),
			}),
		);
		// SendMessageBatch returns HTTP 200 with per-entry failures in `Failed`;
		// throw so the failed deletes surface to the DLQ and the whole fanout
		// replays idempotently rather than silently skipping vector deletes.
		if (result.Failed?.length) {
			const failedIds = result.Failed.map((f) => f.Id).join(", ");
			throw new Error(
				`Search-index vector-delete batch had ${result.Failed.length} failed entries: ${failedIds}`,
			);
		}
	}
};

/**
 * Fanout step of the per-account purge. Read-only against DDB: cheaply
 * enumerates the account's message ids (no per-message describe — see
 * `enumerateAccountPurgeMessageIds`), enqueues their search-index (vector)
 * deletes (#457), then forwards the destructive DDB+S3+CloudFront work to the
 * finalize worker — which already holds those grants and enumerates the full
 * child-entity plan itself — as a `FinalizeAccountDataPurge` event.
 *
 * Runs in the fanout worker, mirroring how `AccountDelete` fans out to
 * `FinalizeAccountDelete`. Scoped entirely to `accountId`; the AccountConfig,
 * its sibling accounts, and the (soft-deleted) account row are untouched.
 *
 * Replay-safe: enumeration is read-only and the search-index/finalize enqueues
 * are idempotent (vector delete and the finalize cascade both no-op on missing
 * rows). A redelivery after the account's rows are gone enumerates an empty
 * plan and forwards a finalize that no-ops.
 */
export const processAccountDataPurge = async (
	event: AccountDataPurgeEvent,
	log: Logger,
	deps: ProcessPurgeFanoutDeps = {},
): Promise<void> => {
	const { accountId, accountConfigId } = event;
	const services = deps.services ?? defaultCascadeServices;
	const sqs = deps.sqs ?? defaultSqsClient;
	const accountFinalizeQueueUrl =
		deps.accountFinalizeQueueUrl ?? getAccountFinalizeQueueUrl();
	const searchIndexQueueUrl =
		deps.searchIndexQueueUrl ?? getSearchIndexQueueUrl();

	let messageIds: string[] = [];
	try {
		const plan = await enumerateAccountPurgeMessageIds(
			accountId,
			services,
			log,
		);
		messageIds = plan.messageIds;
	} catch (error) {
		if (error instanceof NotFoundError) {
			log.info(
				{ accountConfigId, accountId },
				"Account purge fanout: account already gone — no-op",
			);
			return;
		}
		throw error;
	}

	await enqueueVectorDeletes(sqs, searchIndexQueueUrl, accountId, messageIds);
	log.info(
		{ accountConfigId, accountId, count: messageIds.length },
		"Enqueued search-index deletes for purged account",
	);

	const finalizeEvent: AccountDataPurgeFinalizeEvent = {
		type: "FinalizeAccountDataPurge",
		accountId,
		accountConfigId,
	};
	await sqs.send(
		new SendMessageCommand({
			QueueUrl: accountFinalizeQueueUrl,
			MessageBody: JSON.stringify(finalizeEvent),
		}),
	);
	log.info(
		{ accountConfigId, accountId },
		"Enqueued per-account purge finalize event",
	);
};
