import type { IAccountRepository, IMailboxRepository } from "@remit/data-ports";

/** Why mail of `accountId` cannot be moved into `mailboxId`, owned by `ownerId`. */
export const foreignFolderReason = async (
	client: {
		account: Pick<IAccountRepository, "get">;
		mailbox: Pick<IMailboxRepository, "get">;
	},
	accountId: string,
	ownerId: string,
	mailboxId: string,
): Promise<string> => {
	const [folder, owner, account] = await Promise.all([
		client.mailbox.get(ownerId, mailboxId),
		client.account.get(ownerId),
		client.account.get(accountId),
	]);
	return `“${folder.fullPath}” is a folder of ${owner?.email ?? ownerId}, not ${account?.email ?? accountId}. A filter can only move mail into a folder of the account it belongs to.`;
};
