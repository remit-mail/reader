import { inspect } from "node:util";
import {
	AdminUserGlobalSignOutCommand,
	type CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { createLogger, type Logger } from "@remit/logger-lambda";
import { enqueueSearchIndexEvents } from "@remit/search-index-worker";
import type {
	Context,
	SQSBatchResponse,
	SQSEvent,
	SQSHandler,
} from "aws-lambda";
import type { CascadeServices } from "../cascade.js";
import { enumerateCascadeEntities } from "../cascade.js";
import {
	cascadeServices,
	cognitoClient,
	getAccountFinalizeQueueUrl,
	getImapWorkerQueueUrl,
	getSearchIndexQueueUrl,
	getUserPoolId,
	sqsClient,
} from "../config.js";
import type { AccountFanoutEvent, AccountFinalizeEvent } from "../events.js";

export interface ProcessAccountFanoutDeps {
	services: CascadeServices;
	sqs: SQSClient;
	cognito: CognitoIdentityProviderClient;
	userPoolId: string;
	searchIndexQueueUrl: string;
	imapWorkerQueueUrl: string;
	accountFinalizeQueueUrl: string;
}

/**
 * Fanout step of the account-deletion cascade. Read-only: enumerates the
 * AccountConfig's data and dispatches downstream work — search-index
 * deletes, per-account imap-worker stops, a Cognito sign-out, and the
 * finalize enqueue. Throws on any non-swallowable AWS error so SQS partial
 * batch-failure retries the whole record.
 */
export const processAccountFanout = async (
	event: AccountFanoutEvent,
	log: Logger,
	deps: ProcessAccountFanoutDeps = defaultDeps(),
): Promise<void> => {
	const { accountConfigId } = event;
	const { services, sqs, cognito } = deps;

	const accountConfig =
		await services.accountConfigService.get(accountConfigId);
	const cognitoUserId = accountConfig.userId;

	const { entities, messageIds } = await enumerateCascadeEntities(
		accountConfigId,
		services,
		log,
	);

	await enqueueSearchIndexEvents(
		sqs,
		deps.searchIndexQueueUrl,
		messageIds.map((messageId) => ({ type: "delete", messageId })),
	);
	log.info(
		{ accountConfigId, count: messageIds.length },
		"Enqueued search-index deletes",
	);

	const accountIds = entities
		.filter((e) => e.entityType === "Account")
		.map((e) => e.key.accountId);

	for (const accountId of accountIds) {
		await sqs.send(
			new SendMessageCommand({
				QueueUrl: deps.imapWorkerQueueUrl,
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

	await signOutCognitoUser(cognito, deps.userPoolId, cognitoUserId, log);

	const finalizeEvent: AccountFinalizeEvent = {
		type: "FinalizeAccountDelete",
		accountConfigId,
	};
	await sqs.send(
		new SendMessageCommand({
			QueueUrl: deps.accountFinalizeQueueUrl,
			MessageBody: JSON.stringify(finalizeEvent),
		}),
	);
	log.info({ accountConfigId }, "Enqueued finalize event");
};

const signOutCognitoUser = async (
	cognito: CognitoIdentityProviderClient,
	userPoolId: string,
	username: string,
	log: Logger,
): Promise<void> => {
	try {
		await cognito.send(
			new AdminUserGlobalSignOutCommand({
				UserPoolId: userPoolId,
				Username: username,
			}),
		);
		log.info({ username }, "Cognito user signed out globally");
	} catch (error: unknown) {
		if ((error as { name?: string }).name === "UserNotFoundException") {
			log.info({ username }, "Cognito user already gone, skipping sign-out");
			return;
		}
		throw error;
	}
};

const defaultDeps = (): ProcessAccountFanoutDeps => ({
	services: cascadeServices,
	sqs: sqsClient,
	cognito: cognitoClient,
	userPoolId: getUserPoolId(),
	searchIndexQueueUrl: getSearchIndexQueueUrl(),
	imapWorkerQueueUrl: getImapWorkerQueueUrl(),
	accountFinalizeQueueUrl: getAccountFinalizeQueueUrl(),
});

export const handler: SQSHandler = async (
	event: SQSEvent,
	context: Context,
): Promise<SQSBatchResponse> => {
	const log = createLogger(context);
	const batchItemFailures: { itemIdentifier: string }[] = [];

	for (const record of event.Records) {
		try {
			const fanoutEvent: AccountFanoutEvent = JSON.parse(record.body);
			log.info(
				{
					eventType: fanoutEvent.type,
					accountConfigId: fanoutEvent.accountConfigId,
				},
				"Processing account fanout event",
			);

			await processAccountFanout(fanoutEvent, log);
		} catch (error) {
			log.error(
				{ error: inspect(error), messageId: record.messageId },
				"Account fanout event processing failed",
			);
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	return { batchItemFailures };
};
