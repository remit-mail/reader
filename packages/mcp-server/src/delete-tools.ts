import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	deleteLabelWithCascade,
	findFiltersForLabel,
} from "@remit/backend/label-delete";
import type { FilterItem, MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { accept } from "@remit/mailbox-service";
import { z } from "zod";
import type { McpDeps } from "./deps.js";
import {
	absent,
	awaitSettled,
	deleteFolderOnServer,
	folderDeleteRefusal,
	plural,
} from "./folder-tools.js";
import { asJson, notFoundRefusal, refused, toolError } from "./tool-result.js";

const DELETE = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: false,
} as const;

const quoted = (names: readonly string[]): string =>
	names.map((name) => `“${name}”`).join(", ");

const labelFolders = async (
	deps: McpDeps,
	labelId: string,
): Promise<MailboxItem[]> => {
	const mappings = await deps.client.labelMailbox.listByLabel(labelId);
	const folders = await Promise.all(
		mappings.map((mapping) =>
			deps.client.mailbox
				.get(mapping.accountId, mapping.mailboxId)
				.catch(absent),
		),
	);
	return folders.filter((folder) => folder !== undefined);
};

const filterRef = (filter: FilterItem) => ({
	filterId: filter.filterId,
	name: filter.name,
});

const textOf = (result: CallToolResult): string =>
	result.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("");

const alreadyDeleted = (deleted: readonly MailboxItem[]): string =>
	deleted.length === 0
		? " No label folder was deleted."
		: ` Already deleted: ${plural(deleted.length, "label folder", "label folders")}, ${quoted(deleted.map((folder) => folder.fullPath))}.`;

const settledFolder = async (
	deps: McpDeps,
	folder: MailboxItem,
): Promise<MailboxItem | undefined> => {
	const watched = await awaitSettled(
		deps,
		deps.folders,
		folder.accountId,
		folder.mailboxId,
		MailboxSyncStatus.deleting,
	);
	return watched.state === "Present" ? watched.folder : undefined;
};

export const registerDeleteTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
): void => {
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
			const filter = await deps.client.filter
				.get(accountConfigId, filterId)
				.then(accept)
				.catch(notFoundRefusal("Check the filterId against list_filters."));
			if (!filter.ok) return refused(filter.refusal);
			await deps.client.filter.delete(accountConfigId, filterId);
			return asJson({ deleted: true, filter: filterRef(filter.value) });
		},
	);

	server.registerTool(
		"delete_label",
		{
			description:
				"Delete a label and its folder in each mail account, one account at a time, waiting until each mail server confirms. Refuses while a filter still applies the label, or while any label folder holds mail, unless force is true. If one account's server still refuses its folder, the label is kept, the error names the folders already deleted, and calling again deletes the rest. With force, each folder's mail first moves to that account's Trash, the filters that apply the label are deleted and listed in the result, and the label goes once every server confirms. Calling again with the same arguments resumes the wait.",
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
			const forced = force === true;
			const found = await deps.client.label
				.get(accountConfigId, labelId)
				.then(accept)
				.catch(notFoundRefusal("Check the labelId against list_labels."));
			if (!found.ok) return refused(found.refusal);
			const label = found.value;

			const filters = await findFiltersForLabel(
				deps.client,
				accountConfigId,
				labelId,
			);
			if (!forced && filters.length > 0) {
				return toolError(
					`The label “${label.name}” is applied by the ${filters.length === 1 ? "filter" : "filters"} ${quoted(filters.map((filter) => filter.name))}. Point them elsewhere with update_filter or remove them with delete_filter, then call delete_label again; or pass force: true to delete them with the label.`,
				);
			}

			const folders = await labelFolders(deps, labelId);
			for (const folder of folders) {
				if (folder.syncStatus === MailboxSyncStatus.deleting) continue;
				const refusal = await folderDeleteRefusal(
					deps,
					accountConfigId,
					folder,
					forced,
				);
				if (refusal) return refusal;
			}

			const retry = forced
				? "Call delete_label again to retry."
				: "Move the mail out first, or pass force: true to move it to Trash.";
			const deleted: MailboxItem[] = [];
			for (const folder of folders) {
				if (folder.syncStatus !== MailboxSyncStatus.deleting) {
					const stopped = await deleteFolderOnServer(
						deps,
						accountConfigId,
						folder,
						forced,
					);
					if (stopped?.isError) {
						return toolError(
							`${textOf(stopped)} The label “${label.name}” was kept.${alreadyDeleted(deleted)}`,
						);
					}
					if (stopped) return stopped;
				}

				const left = await settledFolder(deps, folder);
				if (!left) {
					deleted.push(folder);
					continue;
				}
				if (left.syncStatus === MailboxSyncStatus.deleting) {
					return asJson({
						labelId,
						name: label.name,
						deletedFolders: deleted.map((done) => done.fullPath),
						pendingFolder: left.fullPath,
						message:
							"The mail server has not confirmed this folder delete yet. Call delete_label again with the same arguments to keep waiting; it will not delete twice.",
					});
				}
				if (left.syncStatus === MailboxSyncStatus.failed) {
					await deps.client.mailboxQueue.dismissMailboxIntent(
						left.mailboxId,
						left.accountId,
					);
				}
				return toolError(
					`The mail server refused to delete the label folder “${left.fullPath}”: ${left.syncFailureReason || "the delete was dropped"}. The label “${label.name}” was kept.${alreadyDeleted(deleted)} ${retry} Calling delete_label again deletes the folders that are left.`,
				);
			}

			const deletedFilters = await deleteLabelWithCascade(
				deps.client,
				accountConfigId,
				labelId,
			);
			return asJson({
				deleted: true,
				labelId,
				name: label.name,
				deletedFilters: deletedFilters.map(filterRef),
			});
		},
	);
};
