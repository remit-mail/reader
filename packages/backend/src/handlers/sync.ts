import type { QueueName } from "../service/queues.js";
import {
	getSyncStatusFor,
	triggerSyncFor,
	triggerSyncSafe,
} from "../service/sync-operations.js";
import type {
	HandlerContext,
	OperationHandler,
	SyncOperationIds,
} from "../types.js";

export { triggerSyncSafe };

export const SyncOperations = {
	SyncOperations_triggerSync: async (context, ctx: HandlerContext<"sync">) =>
		triggerSyncFor(
			ctx.client,
			ctx.identity.accountConfigId,
			(context.request.params as { accountId: string }).accountId,
		),

	SyncOperations_getSyncStatus: async (context, ctx: HandlerContext) =>
		getSyncStatusFor(
			ctx.client,
			ctx.identity.accountConfigId,
			(context.request.params as { accountId: string }).accountId,
		),
} satisfies Record<
	SyncOperationIds,
	OperationHandler<SyncOperationIds, QueueName>
>;
