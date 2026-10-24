import type { IAccountRepository, MailboxItem } from "@remit/data-ports";
import { isReservedFolderName } from "@remit/data-ports/folder-role";
import { mailboxLeafName } from "@remit/data-ports/mailbox-name";
import { MailboxSyncStatus } from "@remit/domain-enums";
import type { MailboxQueueService } from "./mailbox-queue.js";
import { ownedAccount } from "./ownership.js";
import { accept, invalid, type Refusable } from "./refusal.js";

export interface FolderPathDeps {
	mailbox: {
		get(accountId: string, mailboxId: string): Promise<MailboxItem>;
		listAllByAccount(accountId: string): Promise<MailboxItem[]>;
	};
	mailboxQueue: Pick<
		MailboxQueueService,
		"renameMailbox" | "dismissMailboxIntent"
	>;
}

export interface CreateFolderDeps {
	account: Pick<IAccountRepository, "get">;
	mailboxQueue: Pick<MailboxQueueService, "createMailbox">;
}

export interface NewFolder {
	accountId: string;
	namespaceType: MailboxItem["namespaceType"];
	fullPath: string;
}

export interface FolderPathChange {
	accountId: string;
	mailboxId: string;
	fullPath: string;
}

export const folderNameRefusal = (
	target: string,
	hierarchyDelimiter: string,
): Refusable<string> => {
	if (target.trim().length === 0) {
		return invalid("A folder needs a name.");
	}
	if (target.toUpperCase() === "INBOX") {
		return invalid("“INBOX” is reserved for the inbox.");
	}

	// The mailbox sweep reads an unflagged folder under a role's conventional
	// name as a duplicate and reaps it, with its mail, once another folder holds
	// the flag.
	const leaf = mailboxLeafName({ fullPath: target, hierarchyDelimiter });
	if (isReservedFolderName(leaf)) {
		return invalid(
			`“${leaf}” is reserved for a system folder. Pick another name.`,
		);
	}
	return accept(target);
};

const renameTargetRefusal = async (
	deps: Pick<FolderPathDeps, "mailbox">,
	accountId: string,
	before: MailboxItem,
	target: string,
): Promise<Refusable<string>> => {
	// Renaming INBOX leaves an empty INBOX behind, and INBOX is the one name
	// RFC 3501 reserves.
	if (before.fullPath.toUpperCase() === "INBOX") {
		return invalid("The inbox can't be renamed.");
	}
	const named = folderNameRefusal(target, before.hierarchyDelimiter);
	if (!named.ok) return named;

	// A path a pending rename is heading for is as taken as one a folder sits
	// at. A failed rename keeps its target only so the client can offer a
	// retry; nothing is coming for it, so it claims nothing.
	const folders = await deps.mailbox.listAllByAccount(accountId);
	for (const folder of folders) {
		if (folder.mailboxId === before.mailboxId) continue;
		if (folder.fullPath === target) {
			return invalid(`A folder named “${target}” is already there.`);
		}
		if (
			folder.syncStatus === MailboxSyncStatus.pending &&
			folder.pendingPath === target
		) {
			return invalid(
				`“${folder.fullPath}” is already being renamed to “${target}”.`,
			);
		}
	}
	return accept(target);
};

// A fullPath equal to the confirmed one is not a rename: it dismisses a failed
// intent, the one route out of `failed` that enqueues nothing. The row keeps
// the path the server holds until the rename settles.
export const changeFolderPath = async (
	deps: FolderPathDeps,
	change: FolderPathChange,
): Promise<Refusable<MailboxItem>> => {
	const { accountId, mailboxId, fullPath } = change;
	const before = await deps.mailbox.get(accountId, mailboxId);
	if (fullPath === before.fullPath) {
		return accept(
			await deps.mailboxQueue.dismissMailboxIntent(mailboxId, accountId),
		);
	}

	const target = await renameTargetRefusal(deps, accountId, before, fullPath);
	if (!target.ok) return target;

	return accept(
		await deps.mailboxQueue.renameMailbox(mailboxId, fullPath, accountId),
	);
};

export const createFolder = async (
	deps: CreateFolderDeps,
	accountConfigId: string,
	folder: NewFolder,
): Promise<Refusable<MailboxItem>> => {
	const { accountId, namespaceType, fullPath } = folder;
	const owned = ownedAccount(
		await deps.account.get(accountId),
		accountConfigId,
		"act",
	);
	if (!owned.ok) return owned;

	const created = await deps.mailboxQueue.createMailbox(
		{
			accountId,
			namespaceType,
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath,
			uidValidity: 0,
			uidNext: 1,
			highestModseq: "0",
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: 0,
		},
		accountId,
		true,
	);
	if (created.outcome === "PathTaken") {
		return invalid(`A folder named “${fullPath}” is already there.`);
	}
	return accept(created.mailbox);
};
