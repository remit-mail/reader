import type { RescanInput } from "@remit/api-openapi-types";
import { ownedAccount } from "@remit/mailbox-service";
import type { QueueName } from "../service/queues.js";
import { unwrap } from "../service/refusal.js";
import type {
	AccountMessageOperationIds,
	HandlerContext,
	OperationHandler,
} from "../types.js";

export const AccountMessageOperations = {
	AccountMessageOperations_rescanMessages: async (
		context,
		ctx: HandlerContext<"sync" | "messageManagement">,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { accountId } = context.request.params as { accountId: string };
		const { messageIds, move } = context.request.requestBody as RescanInput;
		const client = ctx.client;
		unwrap(
			ownedAccount(await client.account.get(accountId), accountConfigId, "act"),
		);
		return client.rescan.rescan(
			{ accountId, accountConfigId },
			{ messageIds, move: move ?? false },
		);
	},
} satisfies Record<
	AccountMessageOperationIds,
	OperationHandler<AccountMessageOperationIds, QueueName>
>;
