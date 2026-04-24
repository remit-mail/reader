import { env } from "expect-env";
import { logger } from "../logger.js";
import { getClient } from "../service/dynamodb.js";
import { sqsClient } from "../service/sqs.js";
import { triggerAccountSync } from "../service/trigger-sync.js";
import type { OperationHandler, SyncOperationIds } from "../types.js";

export const SyncOperations: Record<
	SyncOperationIds,
	OperationHandler<SyncOperationIds>
> = {
	SyncOperations_triggerSync: async (context) => {
		const { accountId } = context.request.params as { accountId: string };

		// Verify account exists
		const account = await getClient().account.get(accountId);

		const { eventId } = await triggerAccountSync({
			sqsClient,
			queueUrl: env.SQS_QUEUE_URL,
			accountId: account.accountId,
		});

		logger.info(
			{ accountId: account.accountId, eventId },
			"Sync triggered - enqueued SYNC_MAILBOXES event",
		);

		return {
			triggered: true,
			message: `Sync triggered for account ${accountId}`,
		};
	},
};
