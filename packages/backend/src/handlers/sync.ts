import { randomUUID } from "node:crypto";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { env } from "expect-env";
import { logger } from "../logger.js";
import { getClient } from "../service/dynamodb.js";
import { sqsClient } from "../service/sqs.js";
import type { OperationHandler, SyncOperationIds } from "../types.js";

interface SyncMailboxesEvent {
	type: "SYNC_MAILBOXES";
	eventId: string;
	timestamp: number;
	accountId: string;
}

export const SyncOperations: Record<
	SyncOperationIds,
	OperationHandler<SyncOperationIds>
> = {
	SyncOperations_triggerSync: async (context) => {
		const { accountId } = context.request.params as { accountId: string };

		// Verify account exists
		const account = await getClient().account.get(accountId);

		// Enqueue SYNC_MAILBOXES event
		const event: SyncMailboxesEvent = {
			type: "SYNC_MAILBOXES",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId: account.accountId,
		};

		await sqsClient.send(
			new SendMessageCommand({
				QueueUrl: env.SQS_QUEUE_URL,
				MessageBody: JSON.stringify(event),
			}),
		);

		logger.info(
			{ accountId: account.accountId, eventId: event.eventId },
			"Sync triggered - enqueued SYNC_MAILBOXES event",
		);

		return {
			triggered: true,
			message: `Sync triggered for account ${accountId}`,
		};
	},
};
