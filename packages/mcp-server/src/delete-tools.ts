import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { deletableFolder, deleteFolder } from "@remit/backend/folder-delete";
import {
	deleteLabelWithCascade,
	findFiltersForLabel,
} from "@remit/backend/label-delete";
import type { FilterItem, MailboxItem } from "@remit/data-ports";
import { isNotFoundError } from "@remit/data-ports/errors";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { accept } from "@remit/mailbox-service";
import { z } from "zod";
import type { McpDeps } from "./deps.js";
import { awaitSettled, trashFolderMail } from "./folder-tools.js";
import { asJson, notFoundRefusal, refused, toolError } from "./tool-result.js";

const DELETE = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: false,
} as const;

const quoted = (names: readonly string[]): string =>
	names.map((name) => `“${name}”`).join(", ");

const plural = (count: number, one: string, many: string): string =>
	`${count} ${count === 1 ? one : many}`;

const absent = (error: unknown): undefined => {
	if (!isNotFoundError(error)) throw error;
	return undefined;
};

const labelFolders = async (
	deps: McpDeps,
	labelId: string,
): Promise<MailboxItem[]> => {
	const mappings = await deps.labelMailbox.listByLabel(labelId);
	const folders = await Promise.all(
		mappings.map((mapping) =>
			deps.mailbox.get(mapping.accountId, mapping.mailboxId).catch(absent),
		),
	);
	return folders.filter((folder) => folder !== undefined);
};

const filterRef = (filter: FilterItem) => ({
	filterId: filter.filterId,
	name: filter.name,
});

export const registerDeleteTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
): void => {
	const deleteDeps = { ...deps, mailboxQueue: deps.folders.mailboxQueue };

	server.registerTool(
		"delete_filter",
		{
			description:
				"Delete a filter. New mail stops being sorted by it; mail it already moved or labelled stays where it is.",
			inputSchema: {
				filterId: z.string().min(1).describe("Filter from list_filters"),
			},
			annotations: DELETE,
		},
		async ({ filterId }) => {
			const filter = await deps.filter
				.get(accountConfigId, filterId)
				.then(accept)
				.catch(notFoundRefusal("Check the filterId against list_filters."));
			if (!filter.ok) return refused(filter.refusal);
			await deps.filter.delete(accountConfigId, filterId);
			return asJson({ deleted: true, filter: filterRef(filter.value) });
		},
	);

	server.registerTool(
		"delete_label",
		{
			description:
				"Delete a label and its folder in every mail account, and wait until the mail server confirms the folders are gone. Refuses while a filter still applies the label, or while a label folder holds mail on the mail server, unless force is true. With force, each folder's mail first moves to that account's Trash, the filters that apply the label are deleted and listed in the result, and the label goes once the server confirms. Calling again with the same arguments resumes the wait.",
			inputSchema: {
				labelId: z.string().min(1).describe("Label from list_labels"),
				force: z
					.boolean()
					.optional()
					.describe(
						"Move the folders' mail to Trash and delete the filters that apply the label, then delete it",
					),
			},
			annotations: DELETE,
		},
		async ({ labelId, force }) => {
			const label = await deps.label
				.get(accountConfigId, labelId)
				.then(accept)
				.catch(notFoundRefusal("Check the labelId against list_labels."));
			if (!label.ok) return refused(label.refusal);
			const { name } = label.value;

			const filters = await findFiltersForLabel(deps, accountConfigId, labelId);
			if (!force && filters.length > 0) {
				return toolError(
					`The label “${name}” is applied by the ${filters.length === 1 ? "filter" : "filters"} ${quoted(filters.map((filter) => filter.name))}. Point them elsewhere with update_filter or remove them with delete_filter, then call delete_label again; or pass force: true to delete them with the label.`,
				);
			}

			const folders = await labelFolders(deps, labelId);
			const toDelete = folders.filter(
				(folder) => folder.syncStatus !== MailboxSyncStatus.deleting,
			);
			for (const folder of toDelete) {
				const deletable = await deletableFolder(deleteDeps, accountConfigId, {
					accountId: folder.accountId,
					mailboxId: folder.mailboxId,
				});
				if (!deletable.ok) return refused(deletable.refusal);
				if (!force && folder.messageCount > 0) {
					return toolError(
						`The label folder “${folder.fullPath}” still holds ${plural(folder.messageCount, "message", "messages")}. Move them out first, or pass force: true to move them to Trash and delete the label.`,
					);
				}
			}

			for (const folder of toDelete) {
				if (force) {
					const notYet = await trashFolderMail(
						deps,
						accountConfigId,
						folder,
						"delete_label",
					);
					if (notYet) return notYet;
				}
				const deleted = await deleteFolder(deleteDeps, accountConfigId, {
					accountId: folder.accountId,
					mailboxId: folder.mailboxId,
					requireEmpty: true,
				});
				if (!deleted.ok) return refused(deleted.refusal);
			}

			const left: MailboxItem[] = [];
			for (const folder of folders) {
				const watched = await awaitSettled(
					deps,
					deps.folders,
					folder.accountId,
					folder.mailboxId,
					MailboxSyncStatus.deleting,
				);
				if (watched.state === "Present") left.push(watched.folder);
			}

			const refusedBy = left.filter(
				(folder) => folder.syncStatus === MailboxSyncStatus.failed,
			);
			for (const folder of refusedBy) {
				await deps.folders.mailboxQueue.dismissMailboxIntent(
					folder.mailboxId,
					folder.accountId,
				);
			}
			if (refusedBy.length > 0) {
				const reasons = refusedBy
					.map(
						(folder) =>
							`“${folder.fullPath}”: ${folder.syncFailureReason || "no reason given"}`,
					)
					.join("; ");
				return toolError(
					`The mail server kept ${plural(refusedBy.length, "label folder", "label folders")}, so the label “${name}” was kept. ${reasons}. Move the mail out first, or pass force: true to move it to Trash.`,
				);
			}
			if (left.length > 0) {
				return asJson({
					labelId,
					name,
					pendingFolders: left.map((folder) => folder.fullPath),
					message:
						"The mail server has not confirmed every folder delete yet. Call delete_label again with the same arguments to keep waiting; it will not delete twice.",
				});
			}

			const deletedFilters = await deleteLabelWithCascade(
				deps,
				accountConfigId,
				labelId,
			);
			return asJson({
				deleted: true,
				labelId,
				name,
				deletedFilters: deletedFilters.map(filterRef),
			});
		},
	);
};
