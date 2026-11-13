import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LabelColor } from "@remit/domain-enums";
import {
	createLabelWithFolders,
	type LabelWithFolders,
	listLabelsWithFolders,
} from "@remit/mailbox-service";
import { z } from "zod";
import type { McpDeps } from "./deps.js";
import { asJson, refused } from "./tool-result.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const LABEL_WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const;

const toLabel = ({ label, folders }: LabelWithFolders) => ({
	labelId: label.labelId,
	name: label.name,
	color: label.color,
	folders,
});

export const registerLabelReadTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
): void => {
	server.registerTool(
		"list_labels",
		{
			description:
				"List the user's labels. Each label lists its folder in every mail account, with state Present, Pending (the mail server has not confirmed it yet) or Missing, and the mailboxId of a folder that is there.",
			inputSchema: {},
			annotations: READ_ONLY,
		},
		async () => {
			const labels = await listLabelsWithFolders(deps, accountConfigId);
			return asJson({ labels: labels.map(toLabel) });
		},
	);
};

export const registerLabelWriteTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
): void => {
	server.registerTool(
		"create_label",
		{
			description:
				"Create a label and its folder in every mail account, under the account's remit folder. A label with the same name is reused, and calling again creates only the folders that are missing. Returns each folder's state; a Pending folder settles once the mail server confirms it, which list_labels shows.",
			inputSchema: {
				name: z.string().trim().min(1).max(140).describe("Label name"),
				color: z
					.enum(LabelColor)
					.optional()
					.describe("Display color, Default when left out"),
			},
			annotations: LABEL_WRITE,
		},
		async ({ name, color }) => {
			const created = await createLabelWithFolders(
				{
					account: deps.account,
					mailbox: deps.mailbox,
					label: deps.label,
					labelMailbox: deps.labelMailbox,
					mailboxQueue: deps.folders.mailboxQueue,
					log: deps.logger,
				},
				accountConfigId,
				{ name, color },
			);
			if (!created.ok) return refused(created.refusal);
			return asJson(toLabel(created.value));
		},
	);
};
