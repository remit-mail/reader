import {
	AdminDisableUserCommand,
	AdminUserGlobalSignOutCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { AccountConfig } from "@remit/electrodb-entities";
import { isConditionalCheckFailed } from "@remit/remit-electrodb-service";
import { enqueueSearchIndexEvents } from "@remit/search-index-worker";
import { Entity } from "electrodb";
import type { Logger } from "pino";
import { enumerateCascadeEntities } from "../cascade.js";
import {
	accountConfigService,
	accountFinalizeQueueUrl,
	cascadeServices,
	cognitoClient,
	ddbClient,
	graceSeconds,
	imapWorkerQueueUrl,
	searchIndexQueueUrl,
	sqsClient,
	tableName,
	userPoolId,
} from "../config.js";
import type { AccountFanoutEvent } from "../events.js";

const setCascadeFence = async (accountConfigId: string): Promise<boolean> => {
	const entity = new Entity(AccountConfig, {
		client: ddbClient,
		table: tableName,
	});
	try {
		await entity
			.patch({ accountConfigId })
			.set({ cascadeStartedAt: Date.now() })
			.where(({ cascadeStartedAt }, { notExists }) =>
				notExists(cascadeStartedAt),
			)
			.go();
		return true;
	} catch (error: unknown) {
		if (isConditionalCheckFailed(error)) return false;
		throw error;
	}
};

export const processAccountFanout = async (
	event: AccountFanoutEvent,
	log: Logger,
): Promise<void> => {
	const { accountConfigId } = event;

	const accountConfig = await accountConfigService.get(accountConfigId);
	const { userId } = accountConfig;

	log.info({ accountConfigId, userId }, "Disabling Cognito user");
	await cognitoClient.send(
		new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: userId }),
	);
	await cognitoClient.send(
		new AdminUserGlobalSignOutCommand({
			UserPoolId: userPoolId,
			Username: userId,
		}),
	);

	log.info({ accountConfigId }, "Setting idempotency fence");
	const fenceAcquired = await setCascadeFence(accountConfigId);
	if (!fenceAcquired) {
		log.info({ accountConfigId }, "Cascade already started, ack-dropping");
		return;
	}

	log.info({ accountConfigId }, "Enumerating child entities");
	const { entities, messageIds } = await enumerateCascadeEntities(
		accountConfigId,
		cascadeServices,
		log,
	);

	if (messageIds.length > 0) {
		log.info({ count: messageIds.length }, "Fan-out search index deletes");
		const deleteEvents = messageIds.map((messageId) => ({
			type: "delete" as const,
			messageId,
		}));
		await enqueueSearchIndexEvents(
			sqsClient,
			searchIndexQueueUrl,
			deleteEvents,
		);
	}

	log.info({ accountConfigId }, "Fan-out S3 object delete");
	await sqsClient.send(
		new SendMessageCommand({
			QueueUrl: imapWorkerQueueUrl,
			MessageBody: JSON.stringify({
				type: "DeleteAccountObjects",
				accountConfigId,
			}),
		}),
	);

	log.info({ accountConfigId, graceSeconds }, "Scheduling finalize");
	await sqsClient.send(
		new SendMessageCommand({
			QueueUrl: accountFinalizeQueueUrl,
			MessageBody: JSON.stringify({
				type: "FinalizeAccountDelete",
				accountConfigId,
			}),
			DelaySeconds: graceSeconds,
		}),
	);

	log.info(
		{ accountConfigId, entityCount: entities.length },
		"Fanout complete",
	);
};
