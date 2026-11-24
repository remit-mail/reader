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
	const { requestedAt } = await triggerAccountSync({
		queue: client.queues.sync,
		accountId: account.accountId,
		explicitRequest: true,
	});
	return {
		triggered: true,
		message: `Sync triggered for account ${accountId}`,
		requestedAt,
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
		syncRequestedAt: account.syncRequestedAt,
		mailboxes: mailboxes.map(toMailboxSyncProgress),
	};
};
