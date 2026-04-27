import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { logger } from "../logger.js";
import { getClient } from "../service/dynamodb.js";
import { sqsClient } from "../service/sqs.js";
import { triggerAccountSync } from "../service/trigger-sync.js";
import type { OperationHandler, SyncOperationIds } from "../types.js";
import { assertAccountOwnership } from "./account-ownership.js";

export const SyncOperations: Record<
	SyncOperationIds,
	OperationHandler<SyncOperationIds>
> = {
	SyncOperations_triggerSync: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };

		const account = await getClient().account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "act");

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
