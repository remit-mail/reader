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

export interface DeletableFolderDeps {
	account: Pick<IAccountRepository, "get">;
	mailbox: Pick<IMailboxRepository, "get" | "findByPathPrefix">;
	filter: Pick<IFilterRepository, "listByAccountConfig">;
	accountSetting: Pick<IAccountSettingRepository, "get">;
}

export interface FolderDeleteDeps extends DeletableFolderDeps {
	mailboxQueue: Pick<MailboxQueueService, "deleteMailbox">;
}

export interface FolderDelete {
	accountId: string;
	mailboxId: string;
}

/**
 * The refusals that retrying the same delete cannot lift (D4, D13), cheapest
 * first. Records nothing.
 */
export const deletableFolder = async (
	deps: DeletableFolderDeps,
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
	return accept(mailbox);
};

/** Record a folder delete and enqueue it for the mail server, once deletable. */
export const deleteFolder = async (
	deps: FolderDeleteDeps,
	accountConfigId: string,
	target: FolderDelete,
): Promise<Refusable<MailboxItem>> => {
	const deletable = await deletableFolder(deps, accountConfigId, target);
	if (!deletable.ok) return deletable;
	await deps.mailboxQueue.deleteMailbox(target.mailboxId, target.accountId);
	return deletable;
};
