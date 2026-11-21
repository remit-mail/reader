import type { FifoQueueProducer } from "@remit/data-ports";
import { logger } from "@remit/logger";
import { ownedAccount } from "@remit/mailbox-service";
import {
	type FireAndForgetLogger,
	fireAndForget,
} from "../service/fire-and-forget.js";
import type { QueueName } from "../service/queues.js";
import { unwrap } from "../service/refusal.js";
import {
	type SyncMailboxesEvent,
	triggerAccountSync,
} from "../service/trigger-sync.js";
import type {
	HandlerContext,
	OperationHandler,
	SyncOperationIds,
} from "../types.js";
import { toMailboxSyncProgress } from "./sync-progress.js";

interface SyncTriggerDeps {
	queue: FifoQueueProducer<SyncMailboxesEvent>;
	logger: FireAndForgetLogger & {
		info: (fields: Record<string, unknown>, message: string) => void;
	};
}

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
	deps: SyncTriggerDeps,
): Promise<void> => {
	await fireAndForget(
		async () => {
			const { eventId } = await triggerAccountSync({
				queue: deps.queue,
				accountId,
				// POST /sync asks for a sync of this account by name — the refresh
				// control, pull-to-refresh, and the client's automatic poll all land
				// here — so it syncs every mailbox regardless of how recently one
				// ran.
				explicitRequest: true,
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

export const triggerSyncFor = async (
	client: HandlerContext<"sync">["client"],
	accountConfigId: string,
	accountId: string,
) => {
	const account = await client.account.get(accountId);
	unwrap(ownedAccount(account, accountConfigId, "act"));
	void triggerSyncSafe(account.accountId, accountConfigId, {
		queue: client.queues.sync,
		logger,
	});
	return {
		triggered: true,
		message: `Sync triggered for account ${accountId}`,
	};
};

export const getSyncStatusFor = async (
	client: HandlerContext["client"],
	accountConfigId: string,
	accountId: string,
) => {
	const account = await client.account.get(accountId);
	unwrap(ownedAccount(account, accountConfigId, "read"));
	const mailboxes = await client.mailbox.listAllByAccount(accountId);
	return {
		accountId: account.accountId,
		syncPhase: account.syncPhase,
		mailboxCountTotal: account.mailboxCountTotal,
		mailboxCountSynced: account.mailboxCountSynced,
		lastSyncAt: account.lastSyncAt,
		mailboxes: mailboxes.map(toMailboxSyncProgress),
	};
};

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
