import type { SQSClient } from "@aws-sdk/client-sqs";
import { logger } from "@remit/logger-lambda";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { env } from "expect-env";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { getClient } from "../service/dynamodb.js";
import {
	type FireAndForgetLogger,
	fireAndForget,
} from "../service/fire-and-forget.js";
import { sqsClient } from "../service/sqs.js";
import { triggerAccountSync } from "../service/trigger-sync.js";
import type { OperationHandler, SyncOperationIds } from "../types.js";
import { assertAccountOwnership } from "./account-ownership.js";
import { computeMessagesSynced, deriveMailboxPhase } from "./sync-progress.js";

interface SyncTriggerDeps {
	sqsClient: SQSClient;
	queueUrl: string;
	logger: FireAndForgetLogger & {
		info: (fields: Record<string, unknown>, message: string) => void;
	};
}

const defaultSyncTriggerDeps = (): SyncTriggerDeps => ({
	sqsClient,
	queueUrl: env.SQS_QUEUE_URL,
	logger,
});

/**
 * Fire-and-forget enqueue for the POST /sync kick.
 *
 * POST /sync is a best-effort nudge: the web client polls it to wake a sync and
 * acts on no enqueue result in the response. So the enqueue must never fail —
 * nor leak onto — this request or any concurrent read when the queue is
 * unreachable. Previously this handler `await`ed the SQS send directly; with the
 * queue down (smoke/e2e, or an SQS outage in prod) the awaited rejection escaped
 * the handler's promise and landed on whatever read was in flight on the shared
 * event loop, 500-ing unrelated `/mailboxes`, `/threads` and `/outbox` reads.
 *
 * Routing it through fireAndForget catches the rejection at the source, logs it
 * loudly with the alertable structured fields, and resolves to void. A genuine
 * account-lookup / ownership failure still propagates and 500s as normal.
 */
export const triggerSyncSafe = async (
	accountId: string,
	accountConfigId: string,
	deps: SyncTriggerDeps = defaultSyncTriggerDeps(),
): Promise<void> => {
	await fireAndForget(
		async () => {
			const { eventId } = await triggerAccountSync({
				sqsClient: deps.sqsClient,
				queueUrl: deps.queueUrl,
				accountId,
			});
			deps.logger.info(
				{ accountId, eventId },
				"Sync triggered - enqueued SYNC_MAILBOXES event",
			);
		},
		{
			source: "trigger_sync",
			message: "Failed to enqueue SYNC_MAILBOXES on POST /sync (best-effort)",
			ids: { accountId, accountConfigId },
			logger: deps.logger,
		},
	);
};

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

		void triggerSyncSafe(account.accountId, accountConfigId);

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
