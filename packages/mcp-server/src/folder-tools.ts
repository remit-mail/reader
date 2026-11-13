import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { deletableFolder, deleteFolder } from "@remit/backend/folder-delete";
import type { MailboxItem } from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import { isReservedFolderName } from "@remit/data-ports/folder-role";
import { mailboxLeafName } from "@remit/data-ports/mailbox-name";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	changeFolderPath,
	createFolder,
	invalid,
	isRemitRootName,
	ownedFolder,
	settledFolder,
} from "@remit/mailbox-service";
import { z } from "zod";
import type { FolderToolDeps, McpDeps } from "./deps.js";
import { asJson, notFoundRefusal, refused, toolError } from "./tool-result.js";
import { trashFolderOf } from "./trash.js";

const CREATE_DELIMITER = "/";

const FOLDER_WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const;

type Watched = { state: "Present"; folder: MailboxItem } | { state: "Gone" };

const awaitSettled = async (
	deps: McpDeps,
	folders: FolderToolDeps,
	accountId: string,
	mailboxId: string,
	inFlight: MailboxItem["syncStatus"] = MailboxSyncStatus.pending,
): Promise<Watched> => {
	const deadline = Date.now() + folders.settleTimeoutMs;
	for (;;) {
		const folder = await deps.mailbox
			.get(accountId, mailboxId)
			.catch((error: unknown) => {
				if (isNotFoundError(error)) return undefined;
				throw error;
			});
		if (!folder) return { state: "Gone" };
		if (folder.syncStatus !== inFlight || Date.now() >= deadline) {
			return { state: "Present", folder };
		}
		await folders.sleep(folders.pollIntervalMs);
	}
};

const folderState = (folder: MailboxItem) => ({
	accountId: folder.accountId,
	mailboxId: folder.mailboxId,
	fullPath: folder.fullPath,
	syncStatus: folder.syncStatus,
});

const pendingResult = (folder: MailboxItem, retry: string): CallToolResult =>
	asJson({
		...folderState(folder),
		...(folder.pendingPath ? { pendingPath: folder.pendingPath } : {}),
		message: `The mail server has not confirmed this yet. ${retry}`,
	});

const settledOrRefused = (folder: MailboxItem): CallToolResult => {
	const settled = settledFolder(folder);
	if (!settled.ok) return refused(settled.refusal);
	return asJson(folderState(folder));
};

const createOutcome = (watched: Watched, requested: string): CallToolResult => {
	if (watched.state === "Gone") {
		return toolError(
			`The mail server already holds “${requested}” under another path. Call list_mailboxes to find it.`,
		);
	}
	const { folder } = watched;
	switch (folder.syncStatus) {
		case MailboxSyncStatus.synced:
			return asJson(folderState(folder));
		case MailboxSyncStatus.pending:
			return pendingResult(
				folder,
				"Call create_folder again with the same arguments to keep waiting; it will not create a second folder.",
			);
		case MailboxSyncStatus.failed:
			return toolError(
				`The mail server refused to create “${folder.fullPath}”: ${folder.syncFailureReason || "no reason given"}. Pick another name.`,
			);
		default:
			return settledOrRefused(folder);
	}
};

const renameOutcome = (watched: Watched, requested: string): CallToolResult => {
	if (watched.state === "Gone") {
		return toolError(
			`The folder was removed before the rename to “${requested}” settled. Call list_mailboxes to see what is there now.`,
		);
	}
	const { folder } = watched;
	switch (folder.syncStatus) {
		case MailboxSyncStatus.synced:
			return asJson(folderState(folder));
		case MailboxSyncStatus.pending:
			return pendingResult(
				folder,
				"Call rename_folder again with the same arguments to keep waiting; it will not rename twice.",
			);
		case MailboxSyncStatus.failed:
			return toolError(
				`The mail server refused to rename “${folder.fullPath}” to “${requested}”: ${folder.syncFailureReason || "no reason given"}. Call rename_folder again to retry, or pass the current path “${folder.fullPath}” to drop the failed rename.`,
			);
		default:
			return settledOrRefused(folder);
	}
};

const deleteOutcome = (watched: Watched): CallToolResult => {
	if (watched.state === "Gone") return asJson({ deleted: true });
	const { folder } = watched;
	switch (folder.syncStatus) {
		case MailboxSyncStatus.deleting:
			return asJson({
				...folderState(folder),
				message:
					"The mail server has not confirmed this yet. Call delete_folder again with the same arguments to keep waiting; it will not delete twice.",
			});
		case MailboxSyncStatus.failed:
			return toolError(
				`The mail server refused to delete “${folder.fullPath}”: ${folder.syncFailureReason || "no reason given"}. Call delete_folder again to retry.`,
			);
		default:
			return toolError(
				`The delete of “${folder.fullPath}” was dropped before the mail server confirmed it. Call list_mailboxes to see what is there now.`,
			);
	}
};

const notFound = notFoundRefusal("");

// Folders the mail app, the mail server or Remit itself depends on, on top of
// what the shared delete refuses: INBOX, folders with subfolders and folders a
// filter or role points at.
const keptFolderReason = async (
	deps: McpDeps,
	accountConfigId: string,
	folder: MailboxItem,
): Promise<string | undefined> => {
	const leaf = mailboxLeafName(folder);
	const specialUse = folder.specialUse ?? [];
	if (specialUse.length > 0) {
		return `“${folder.fullPath}” is the account's ${specialUse.join(" and ")} folder, which the mail app relies on.`;
	}
	if (isReservedFolderName(leaf)) {
		return `“${folder.fullPath}” carries a system folder name the mail app relies on.`;
	}
	if (isRemitRootName(leaf)) {
		return `“${folder.fullPath}” holds Remit's label folders.`;
	}
	const mapping = (
		await deps.labelMailbox.listByAccount(folder.accountId)
	).find((row) => row.mailboxId === folder.mailboxId);
	if (mapping) {
		const label = await deps.label.get(accountConfigId, mapping.labelId);
		return `“${folder.fullPath}” is the folder of the label “${label.name}”. Delete the label instead.`;
	}
	return undefined;
};

const movingOut = async (deps: McpDeps, mailboxId: string): Promise<number> =>
	(
		await deps.message.listStrandedPlacements([mailboxId], Date.now() + 1)
	).filter((row) => row.originalMailboxId === mailboxId).length;

// Moves out of the folder settle before it is deleted: the server must hold
// that mail in Trash before DELETE removes the folder (imap-mutations R2: wait).
const awaitMovedOut = async (
	deps: McpDeps,
	mailboxId: string,
): Promise<number> => {
	const { folders } = deps;
	const deadline = Date.now() + folders.settleTimeoutMs;
	for (;;) {
		const pending = await movingOut(deps, mailboxId);
		if (pending === 0 || Date.now() >= deadline) return pending;
		await folders.sleep(folders.pollIntervalMs);
	}
};

// Force never loses mail: it moves what the folder holds to Trash and waits
// for the server to confirm, and only then does the delete go ahead.
const trashFolderMail = async (
	deps: McpDeps,
	accountConfigId: string,
	folder: MailboxItem,
): Promise<CallToolResult | undefined> => {
	const trash = await trashFolderOf(deps, folder.accountId);
	if (!trash.ok) return refused(trash.refusal);
	const held = await deps.message.listAllByMailbox(folder.mailboxId);
	if (held.length > 0) {
		await deps.messageMove.moveMessages(
			accountConfigId,
			held.map((row) => row.messageId),
			trash.value,
			folder.accountId,
		);
	}
	const pending = await awaitMovedOut(deps, folder.mailboxId);
	if (pending > 0) {
		return asJson({
			...folderState(folder),
			message: `${pending} ${pending === 1 ? "message is" : "messages are"} still moving to Trash. Call delete_folder again with the same arguments to keep waiting; the folder is deleted once they have arrived.`,
		});
	}
	const left = await deps.message.listByMailbox(folder.mailboxId, { limit: 1 });
	if (left.items.length > 0) {
		return toolError(
			`Not all mail in “${folder.fullPath}” could be moved to Trash, so the folder was kept. Call delete_folder again to retry.`,
		);
	}
	return undefined;
};

export const registerFolderTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
): void => {
	server.registerTool(
		"create_folder",
		{
			description:
				"Create a folder in one email account and wait until the mail server confirms it. Returns the confirmed path, or the pending state if the server is slow; calling again with the same arguments resumes the wait.",
			inputSchema: {
				accountId: z.string().min(1).describe("Account from list_mailboxes"),
				fullPath: z
					.string()
					.min(1)
					.describe(
						`Full folder path, levels separated by "${CREATE_DELIMITER}", e.g. "Projects/Acme"`,
					),
			},
			annotations: FOLDER_WRITE,
		},
		async ({ accountId, fullPath }) => {
			const { folders } = deps;
			const created = await createFolder(
				{
					account: deps.account,
					mailbox: deps.mailbox,
					mailboxQueue: folders.mailboxQueue,
				},
				accountConfigId,
				{ accountId, namespaceType: "personal", fullPath },
			);
			if (!created.ok) return refused(created.refusal);
			return createOutcome(
				await awaitSettled(
					deps,
					folders,
					accountId,
					created.value.mailbox.mailboxId,
				),
				fullPath,
			);
		},
	);

	server.registerTool(
		"rename_folder",
		{
			description:
				"Rename a folder, or move it under another parent by giving a new full path, and wait until the mail server confirms it. Subfolders move with it. Returns the confirmed path, or the pending state if the server is slow; calling again with the same arguments resumes the wait.",
			inputSchema: {
				accountId: z.string().min(1).describe("Account from list_mailboxes"),
				mailboxId: z.string().min(1).describe("Folder from list_mailboxes"),
				fullPath: z
					.string()
					.min(1)
					.describe(
						'New full path, e.g. "Archive/2025" to move "2025" under "Archive"',
					),
			},
			annotations: FOLDER_WRITE,
		},
		async ({ accountId, mailboxId, fullPath }) => {
			const { folders } = deps;

			const changed = await changeFolderPath(
				{
					account: deps.account,
					mailbox: deps.mailbox,
					mailboxQueue: folders.mailboxQueue,
				},
				accountConfigId,
				{ accountId, mailboxId, fullPath },
			);
			if (!changed.ok) return refused(changed.refusal);

			return renameOutcome(
				await awaitSettled(deps, folders, accountId, mailboxId),
				fullPath,
			);
		},
	);

	server.registerTool(
		"delete_folder",
		{
			description:
				"Delete an empty folder on the mail server and in Remit, and wait until the server confirms it. Refuses a folder that still holds messages unless force is true, a folder with subfolders (delete those first), system folders, Remit's label folders and folders a filter or folder role uses. With force, the folder's mail first moves to Trash, and the folder is deleted once the server confirms the moves. Calling again with the same arguments resumes the wait.",
			inputSchema: {
				accountId: z.string().min(1).describe("Account from list_mailboxes"),
				mailboxId: z.string().min(1).describe("Folder from list_mailboxes"),
				force: z
					.boolean()
					.optional()
					.describe(
						"Move the folder's messages to Trash first, then delete the folder",
					),
			},
			annotations: { ...FOLDER_WRITE, destructiveHint: true },
		},
		async ({ accountId, mailboxId, force }) => {
			const { folders } = deps;
			const owned = await ownedFolder(
				deps,
				accountConfigId,
				accountId,
				mailboxId,
			).catch(notFound);
			if (!owned.ok) return refused(owned.refusal);
			const folder = owned.value;

			if (folder.syncStatus !== MailboxSyncStatus.deleting) {
				const deleteDeps = { ...deps, mailboxQueue: folders.mailboxQueue };
				const deletable = await deletableFolder(deleteDeps, accountConfigId, {
					accountId,
					mailboxId,
				});
				if (!deletable.ok) return refused(deletable.refusal);
				const kept = await keptFolderReason(deps, accountConfigId, folder);
				if (kept) return refused(invalid(kept).refusal);
				const count = folder.messageCount;
				if (!force && count > 0) {
					return toolError(
						`“${folder.fullPath}” still holds ${count} ${count === 1 ? "message" : "messages"}. Move them out first, for example with move_folder_messages, and call delete_folder again once the moves have settled; or pass force: true to move them to Trash and delete the folder.`,
					);
				}
				if (force) {
					const notYet = await trashFolderMail(deps, accountConfigId, folder);
					if (notYet) return notYet;
				}
				const deleted = await deleteFolder(deleteDeps, accountConfigId, {
					accountId,
					mailboxId,
				});
				if (!deleted.ok) return refused(deleted.refusal);
			}

			return deleteOutcome(
				await awaitSettled(
					deps,
					folders,
					accountId,
					mailboxId,
					MailboxSyncStatus.deleting,
				),
			);
		},
	);
};
