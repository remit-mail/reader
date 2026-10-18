import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { readConfigDocument } from "@remit/config-format";
import type {
	AccountItem,
	IAccountRepository,
	IConfigImportRepository,
} from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";

export interface AccountDeletionDeps {
	account: Pick<IAccountRepository, "update">;
	sqsClient: SQSClient;
	accountFanoutQueueUrl: string;
	log: Logger;
}

/**
 * The purge request goes out before the tombstone is written. An account whose
 * request never left still reads as not deleted, so whoever deleted it — the
 * user, or the start-up repair below — finds it again and asks again; the
 * other order would hide an account whose data nothing is coming to remove.
 */
export const deleteAccount = async (
	deps: AccountDeletionDeps,
	account: Pick<AccountItem, "accountId" | "accountConfigId">,
	deletedAt: number,
): Promise<void> => {
	const { accountId, accountConfigId } = account;
	await deps.sqsClient.send(
		new SendMessageCommand({
			QueueUrl: deps.accountFanoutQueueUrl,
			MessageBody: JSON.stringify({
				type: "AccountDataPurge",
				accountId,
				accountConfigId,
			}),
		}),
	);
	await deps.account.update(accountId, { deletedAt, isActive: false });
	// biome-ignore lint/plugin/no-logger-info: account data purge is an audit-grade signal
	deps.log.info({ accountId, accountConfigId }, "Account data purge initiated");
};

export interface HalfDeletedAccountDeps extends AccountDeletionDeps {
	account: Pick<IAccountRepository, "update" | "listAll">;
	configImport: Pick<IConfigImportRepository, "listByAccountConfig">;
	now?: () => number;
}

const importedAccountIds = async (
	configImport: HalfDeletedAccountDeps["configImport"],
	accountConfigId: string,
): Promise<Set<string>> => {
	const imports = await configImport.listByAccountConfig(accountConfigId);
	return new Set(
		imports.flatMap((row) =>
			readConfigDocument(row.document).accounts.map(
				(account) => account.accountId,
			),
		),
	);
};

/**
 * Before #1384 a delete stored `isActive=false` and dropped `deletedAt`, so the
 * account stayed listed and kept syncing after its purge. Only two writers ever
 * leave an account inactive: that delete, and a config import, which creates
 * accounts inactive until their credentials arrive and names each one, by id,
 * in the document it records. An inactive, untombstoned account no import
 * names is one of those deletes, and this finishes it.
 */
export const finishHalfDeletedAccounts = async (
	deps: HalfDeletedAccountDeps,
): Promise<AccountItem[]> => {
	const now = deps.now ?? Date.now;
	const inactive = (await deps.account.listAll()).filter(
		(account) => !account.isActive && account.deletedAt === undefined,
	);

	const halfDeleted: AccountItem[] = [];
	for (const accountConfigId of new Set(
		inactive.map((account) => account.accountConfigId),
	)) {
		const imported = await importedAccountIds(
			deps.configImport,
			accountConfigId,
		);
		halfDeleted.push(
			...inactive.filter(
				(account) =>
					account.accountConfigId === accountConfigId &&
					!imported.has(account.accountId),
			),
		);
	}

	for (const account of halfDeleted) {
		await deleteAccount(deps, account, now());
	}
	return halfDeleted;
};
