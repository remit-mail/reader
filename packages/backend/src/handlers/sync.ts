import { logger } from "@remit/remit-logger-lambda";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import { sqsClient } from "../service/sqs.js";
import { triggerAccountSync } from "../service/trigger-sync.js";
import type { OperationHandler, SyncOperationIds } from "../types.js";
import { assertAccountOwnership } from "./account-ownership.js";
import { computeMessagesSynced, deriveMailboxPhase } from "./sync-progress.js";

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

	SyncOperations_getSyncStatus: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { accountId } = context.request.params as { accountId: string };

		const client = getClient();
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "read");

		// Collect all mailboxes (read-only — does not write or contend with sync lock)
		const mailboxes = await client.mailbox.listAllByAccount(accountId);

		return {
			accountId: account.accountId,
			syncPhase: account.syncPhase,
			mailboxCountTotal: account.mailboxCountTotal,
			mailboxCountSynced: account.mailboxCountSynced,
			mailboxes: mailboxes.map((mailbox) => ({
				mailboxId: mailbox.mailboxId,
				fullPath: mailbox.fullPath,
				phase: deriveMailboxPhase(mailbox),
				messagesTotal: mailbox.messageCount ?? 0,
				messagesSynced: computeMessagesSynced(mailbox),
				lastSyncedAt: mailbox.lastMessageSyncAt || undefined,
			})),
		};
	},
};
