import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import {
	createLogger,
	type Logger,
	withTelemetry,
} from "@remit/logger-lambda";
import type { SQSBatchResponse, SQSEvent, SQSHandler } from "aws-lambda";
import type { CascadeServices } from "../cascade.js";
import { enumerateCascadeEntities } from "../cascade.js";
import {
	cascadeServices,
	getAccountFinalizeQueueUrl,
	getAccountPurgeDeleteQueueUrl,
	getImapWorkerQueueUrl,
	sqsClient,
} from "../config.js";
import {
	type DeletionCapabilities,
	getDeletionCapabilities,
} from "../deletion-capabilities.js";
import type {
	AccountDeleteEvent,
	AccountFanoutEvent,
	AccountFinalizeEvent,
} from "../events.js";
import { processAccountExport } from "./account-export.js";
import { processAccountDataPurge } from "./account-purge.js";
import { processOrganizeJob } from "./organize-job.js";

export interface ProcessAccountFanoutDeps {
	services?: CascadeServices;
	sqs?: SQSClient;
	signOut?: DeletionCapabilities["signOut"];
	imapWorkerQueueUrl?: string;
	accountFinalizeQueueUrl?: string;
	accountPurgeDeleteQueueUrl?: string;
}

/**
 * Fanout step of the account-deletion cascade. Read-only: enumerates the
 * AccountConfig's data and dispatches downstream work — search-index
 * deletes, per-account imap-worker stops, a sign-out, and the finalize
 * enqueue. Throws on any non-swallowable error so SQS partial batch-failure
 * retries the whole record.
 */
export const processAccountFanout = async (
	event: AccountFanoutEvent,
	log: Logger,
	deps: ProcessAccountFanoutDeps = {},
): Promise<void> => {
	const services = deps.services ?? cascadeServices;
	const sqs = deps.sqs ?? sqsClient;

	if (event.type === "AccountDataPurge") {
		await processAccountDataPurge(event, log, {
			services,
			sqs,
			accountPurgeDeleteQueueUrl:
				deps.accountPurgeDeleteQueueUrl ?? getAccountPurgeDeleteQueueUrl(),
		});
		return;
	}

	if (event.type === "AccountExport") {
		await processAccountExport(event, log);
		return;
	}

	if (event.type === "OrganizeJob") {
		await processOrganizeJob(event, log);
		return;
	}

	await processAccountDelete(event, log, services, sqs, deps);
};

const processAccountDelete = async (
	event: AccountDeleteEvent,
	log: Logger,
	services: CascadeServices,
	sqs: SQSClient,
	deps: ProcessAccountFanoutDeps,
): Promise<void> => {
	const { accountConfigId } = event;
	const signOut = deps.signOut ?? (await getDeletionCapabilities()).signOut;
	const imapWorkerQueueUrl = deps.imapWorkerQueueUrl ?? getImapWorkerQueueUrl();
	const accountFinalizeQueueUrl =
		deps.accountFinalizeQueueUrl ?? getAccountFinalizeQueueUrl();

	const accountConfig =
		await services.accountConfigService.get(accountConfigId);
	const userId = accountConfig.userId;

	const { entities, messageIds: _messageIds } = await enumerateCascadeEntities(
		accountConfigId,
		services,
		log,
	);

	const accountIds = entities
		.filter((e) => e.entityType === "Account")
		.map((e) => e.key.accountId);

	for (const accountId of accountIds) {
		await sqs.send(
			new SendMessageCommand({
				QueueUrl: imapWorkerQueueUrl,
				MessageBody: JSON.stringify({
					type: "IMAP_WORKER_STOP",
					accountConfigId,
					accountId,
				}),
			}),
		);
	}
	log.info(
		{ accountConfigId, count: accountIds.length },
		"Enqueued imap-worker stop signals",
	);

	await signOut(userId, log);

	const finalizeEvent: AccountFinalizeEvent = {
		type: "FinalizeAccountDelete",
		accountConfigId,
	};
	await sqs.send(
		new SendMessageCommand({
			QueueUrl: accountFinalizeQueueUrl,
			MessageBody: JSON.stringify(finalizeEvent),
		}),
	);
	log.info({ accountConfigId }, "Enqueued finalize event");
};

const log = createLogger();

export const handler: SQSHandler = withTelemetry(
	async (event: SQSEvent): Promise<SQSBatchResponse> => {
		const batchItemFailures: { itemIdentifier: string }[] = [];

		for (const record of event.Records) {
			const fanoutEvent: AccountFanoutEvent = JSON.parse(record.body);
			log.info(
				{
					eventType: fanoutEvent.type,
					accountConfigId: fanoutEvent.accountConfigId,
				},
				"Processing account fanout event",
			);

			const failed = await processAccountFanout(fanoutEvent, log)
				.then(() => false)
				.catch((error) => {
					log.error(
						{ error, messageId: record.messageId },
						"Account fanout event processing failed",
					);
					return true;
				});

			if (failed) {
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	},
);
