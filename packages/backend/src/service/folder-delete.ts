import type {
	IAccountRepository,
	IAccountSettingRepository,
	IFilterRepository,
	IMailboxRepository,
	MailboxItem,
} from "@remit/data-ports";
import {
	accept,
	folderInAccount,
	invalid,
	type MailboxQueueService,
	ownedAccount,
	type Refusable,
} from "@remit/mailbox-service";
import {
	bindingsRefusal,
	loadMailboxBindings,
} from "../handlers/mailbox-bindings.js";

export interface FolderDeleteDeps {
	account: Pick<IAccountRepository, "get">;
	mailbox: Pick<IMailboxRepository, "get" | "findByPathPrefix">;
	filter: Pick<IFilterRepository, "listByAccountConfig">;
	accountSetting: Pick<IAccountSettingRepository, "get">;
	mailboxQueue: Pick<MailboxQueueService, "deleteMailbox">;
}

export interface FolderDelete {
	accountId: string;
	mailboxId: string;
}

/**
 * Record a folder delete and enqueue it for the mail server, after the
 * refusals that retrying the same request cannot lift (D4, D13), cheapest
 * first, so none of them records anything.
 */
export const deleteFolder = async (
	deps: FolderDeleteDeps,
	accountConfigId: string,
	{ accountId, mailboxId }: FolderDelete,
): Promise<Refusable<MailboxItem>> => {
	const owned = ownedAccount(
		await deps.account.get(accountId),
		accountConfigId,
		"act",
	);
	if (!owned.ok) return owned;
	const folder = folderInAccount(
		await deps.mailbox.get(accountId, mailboxId),
		accountId,
		"act",
	);
	if (!folder.ok) return folder;
	const mailbox = folder.value;

	if (mailbox.fullPath.toUpperCase() === "INBOX") {
		return invalid("The inbox can't be deleted.");
	}

	const children = await deps.mailbox.findByPathPrefix(
		accountId,
		mailbox.fullPath,
		mailbox.hierarchyDelimiter,
	);
	if (children.length > 0) {
		// The server would keep the parent's name as a placeholder and leave the
		// children untouched — an outcome no local row describes (D9).
		return invalid(
			`“${mailbox.fullPath}” has folders inside it. Delete those first.`,
		);
	}

	const bound = bindingsRefusal(
		mailbox,
		await loadMailboxBindings(deps, accountConfigId, accountId, mailboxId),
	);
	if (bound) return invalid(bound);

	await deps.mailboxQueue.deleteMailbox(mailboxId, accountId);
	return accept(mailbox);
};
