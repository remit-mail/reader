import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { NotFoundError } from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import {
	type CascadeServices,
	enumerateAccountPurgeEntities,
} from "../cascade.js";
import {
	cascadeServices as defaultCascadeServices,
	sqsClient as defaultSqsClient,
	getAccountFinalizeQueueUrl,
} from "../config.js";
import type {
	AccountDataPurgeEvent,
	AccountDataPurgeFinalizeEvent,
} from "../events.js";

export interface ProcessPurgeFanoutDeps {
	services?: CascadeServices;
	sqs?: SQSClient;
	accountFinalizeQueueUrl?: string;
}

/**
 * Fanout step of the per-account purge. Read-only against DDB: enumerates the
 * account's message ids, enqueues their search-index (vector) deletes (#457),
 * then forwards the destructive DDB+S3+CloudFront work to the finalize worker
 * — which already holds those grants — as a `FinalizeAccountDataPurge` event.
 *
 * Runs in the fanout worker, mirroring how `AccountDelete` fans out to
 * `FinalizeAccountDelete`. Scoped entirely to `accountId`; the AccountConfig,
 * its sibling accounts, and the (soft-deleted) account row are untouched.
 *
 * Replay-safe: enumeration is read-only and the search-index/finalize enqueues
 * are idempotent. A redelivery after the account's rows are gone enumerates an
 * empty plan and forwards a finalize that no-ops.
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

	let messageIds: string[] = [];
	try {
		const plan = await enumerateAccountPurgeEntities(
			accountConfigId,
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
