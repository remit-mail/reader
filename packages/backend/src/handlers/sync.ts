import { logger } from "../logger.js";
import { getClient } from "../service/dynamodb.js";
import type { OperationHandler, SyncOperationIds } from "../types.js";

export const SyncOperations: Record<
	SyncOperationIds,
	OperationHandler<SyncOperationIds>
> = {
	SyncOperations_triggerSync: async (context) => {
		const { accountId } = context.request.params as { accountId: string };

		// Verify account exists
		const account = await getClient().account.get(accountId);

		logger.info({ accountId: account.accountId }, "Sync triggered");

		// In a real implementation, this would send a message to SQS
		// to trigger the sync worker. For now, we just acknowledge.
		return {
			triggered: true,
			message: `Sync triggered for account ${accountId}`,
		};
	},
};
