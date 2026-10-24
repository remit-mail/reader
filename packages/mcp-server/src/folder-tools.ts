import { setTimeout as sleep } from "node:timers/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MailboxItem } from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	changeFolderPath,
	createFolder,
	folderInAccount,
	ownedAccount,
	settledFolder,
} from "@remit/mailbox-service";
import { z } from "zod";
import type { FolderToolDeps, McpDeps } from "./deps.js";
import { asJson, refused, toolError } from "./tool-result.js";

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
		if (
			folder.syncStatus !== MailboxSyncStatus.pending ||
			Date.now() >= deadline
		) {
			return { state: "Present", folder };
		}
		await sleep(folders.pollIntervalMs);
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

			const owned = ownedAccount(
				await deps.account.get(accountId),
				accountConfigId,
				"act",
			);
			if (!owned.ok) return refused(owned.refusal);

			const existing = (await deps.mailbox.listAllByAccount(accountId)).find(
				(folder) => folder.fullPath === fullPath,
			);
			if (existing) {
				return createOutcome(
					await awaitSettled(deps, folders, accountId, existing.mailboxId),
					fullPath,
				);
			}

			const created = await createFolder(
				{ account: deps.account, mailboxQueue: folders.mailboxQueue },
				accountConfigId,
				{ accountId, namespaceType: "personal", fullPath },
			);
			if (!created.ok) return refused(created.refusal);
			return createOutcome(
				await awaitSettled(deps, folders, accountId, created.value.mailboxId),
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

			const owned = ownedAccount(
				await deps.account.get(accountId),
				accountConfigId,
				"act",
			);
			if (!owned.ok) return refused(owned.refusal);

			const before = folderInAccount(
				await deps.mailbox.get(accountId, mailboxId),
				accountId,
				"act",
			);
			if (!before.ok) return refused(before.refusal);

			const resuming =
				before.value.syncStatus === MailboxSyncStatus.pending &&
				before.value.pendingPath === fullPath;
			if (!resuming) {
				if (before.value.syncStatus !== MailboxSyncStatus.failed) {
					const settled = settledFolder(before.value);
					if (!settled.ok) return refused(settled.refusal);
				}
				const changed = await changeFolderPath(
					{ mailbox: deps.mailbox, mailboxQueue: folders.mailboxQueue },
					{ accountId, mailboxId, fullPath },
				);
				if (!changed.ok) return refused(changed.refusal);
			}

			return renameOutcome(
				await awaitSettled(deps, folders, accountId, mailboxId),
				fullPath,
			);
		},
	);
};
