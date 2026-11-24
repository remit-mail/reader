import { logger } from "@remit/logger";
import { ownedAccount } from "@remit/mailbox-service";
import { toMailboxSyncProgress } from "../handlers/sync-progress.js";
import type { RemitClient } from "./data-client.js";
import { unwrap } from "./refusal.js";
import { triggerAccountSync } from "./trigger-sync.js";

export const triggerSyncFor = async (
	client: RemitClient<"sync">,
	accountConfigId: string,
	accountId: string,
) => {
	const account = await client.account.get(accountId);
	unwrap(ownedAccount(account, accountConfigId, "act"));
	const { eventId } = await triggerAccountSync({
		queue: client.queues.sync,
		accountId: account.accountId,
		explicitRequest: true,
	});
	// biome-ignore lint/plugin/no-logger-info: records the account and event for a successful sync request
	logger.info(
		{ accountId: account.accountId, eventId },
		"Sync triggered - enqueued SYNC_MAILBOXES event",
	);
	return {
		triggered: true,
		message: `Sync triggered for account ${accountId}`,
	};
};

export const getSyncStatusFor = async (
	client: RemitClient<never>,
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
