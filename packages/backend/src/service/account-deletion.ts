import { readConfigDocument } from "@remit/config-format";
import type {
	AccountDataPurgeEvent,
	AccountItem,
	IAccountRepository,
	IConfigImportRepository,
	QueueProducer,
} from "@remit/data-ports";
import type { Logger } from "@remit/logger";

export interface AccountDeletionDeps {
	account: Pick<IAccountRepository, "update">;
	queue: QueueProducer<AccountDataPurgeEvent>;
	log: Logger;
}

export const deleteAccount = async (
	deps: AccountDeletionDeps,
	account: Pick<AccountItem, "accountId" | "accountConfigId">,
	deletedAt: number,
): Promise<void> => {
	const { accountId, accountConfigId } = account;
	// Purge first: an account whose request never left still reads as not deleted, so it is found and asked for again.
	await deps.queue.send({
		body: { type: "AccountDataPurge", accountId, accountConfigId },
	});
	await deps.account.update(accountId, { deletedAt, isActive: false });
	deps.log.info({ accountId, accountConfigId }, "Account data purge initiated");
};

export interface HalfDeletedAccountDeps extends AccountDeletionDeps {
	account: Pick<IAccountRepository, "update" | "listAll">;
	configImport: Pick<IConfigImportRepository, "listByAccountConfig">;
}

/**
 * Before #1384 a delete stored `isActive=false` and dropped `deletedAt`. Of the
 * writers in this repo only that delete and a config import leave an account
 * inactive, and an import names each account it creates in its stored
 * document. The public update endpoint accepts `isActive` as sent, so a caller
 * outside the repo can also leave one inactive.
 */
export const finishHalfDeletedAccounts = async (
	deps: HalfDeletedAccountDeps,
): Promise<void> => {
	const imported = new Map<string, Set<string>>();
	for (const account of await deps.account.listAll()) {
		if (account.isActive || account.deletedAt !== undefined) continue;
		let names = imported.get(account.accountConfigId);
		if (!names) {
			const imports = await deps.configImport.listByAccountConfig(
				account.accountConfigId,
			);
			names = new Set(
				imports.flatMap((row) =>
					readConfigDocument(row.document).accounts.map((a) => a.accountId),
				),
			);
			imported.set(account.accountConfigId, names);
		}
		if (names.has(account.accountId)) continue;
		await deleteAccount(deps, account, Date.now());
	}
};
