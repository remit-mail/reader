import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	AddressResponseSchema,
	AddressTrustFlagSchema,
	AppointFolderRoleInputSchema,
	BulkMessageInputSchema,
	BulkUpdateFlagsInputSchema,
	CanonicalMailboxRoleSchema,
	LabelResponseSchema,
	OrganizeInputSchema,
	TestConnectionInputSchema,
	UpdateAddressInputSchema,
	UpdateFlagsInputSchema,
	UpdateLabelInputSchema,
	UpdateMessageLabelsInputSchema,
} from "@remit/api-zod-schemas";
import {
	appointFolderRoleFor,
	emptyTrashFor,
	getRawMessageFor,
	notSpamFor,
	previewOrganizeFor,
	reportSpamFor,
	searchAddressesFor,
	updateAddressFor,
	updateFlagsFor,
	updateLabelFor,
	updateMessageFlagsFor,
	updateMessageLabelsFor,
} from "@remit/backend/mail-action-operations";
import { z } from "zod";
import type { McpDeps } from "./deps.js";
import { asJson } from "./tool-result.js";

const accountId = TestConnectionInputSchema.shape.accountId.unwrap();
const messageId = BulkMessageInputSchema.shape.messageIds.element;
const addressId = AddressResponseSchema.shape.addressId;
const labelId = LabelResponseSchema.shape.labelId;
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const;
const DESTRUCTIVE = { ...WRITE, destructiveHint: true } as const;

export const registerMailActionReadTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
): void => {
	server.registerTool(
		"get_raw_message",
		{
			description: "Get the raw RFC822/MIME source of a message.",
			annotations: READ_ONLY,
			inputSchema: { messageId },
		},
		async ({ messageId }) =>
			asJson(await getRawMessageFor(deps.client, accountConfigId, messageId)),
	);
	server.registerTool(
		"preview_organize",
		{
			description:
				"Preview the messages an organize rule would change without applying it.",
			annotations: READ_ONLY,
			inputSchema: { accountId, ...OrganizeInputSchema.shape },
		},
		async ({ accountId, ...input }) =>
			asJson(
				await previewOrganizeFor(
					deps.client,
					accountConfigId,
					accountId,
					input,
				),
			),
	);
	server.registerTool(
		"search_addresses",
		{
			description: "Search saved sender and recipient addresses.",
			annotations: READ_ONLY,
			inputSchema: {
				q: z.string(),
				limit: z.number().int().optional(),
				flag: AddressTrustFlagSchema.optional(),
			},
		},
		async (input) =>
			asJson(await searchAddressesFor(deps.client, accountConfigId, input)),
	);
};

export const registerMailActionWriteTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
	userId: string,
): void => {
	server.registerTool(
		"update_message_flags",
		{
			description: "Change read, starred, or star-color flags on one message.",
			annotations: WRITE,
			inputSchema: { messageId, ...UpdateFlagsInputSchema.shape },
		},
		async ({ messageId, ...input }) =>
			asJson(
				await updateMessageFlagsFor(
					deps.client,
					accountConfigId,
					messageId,
					input,
				),
			),
	);
	server.registerTool(
		"update_flags",
		{
			description: "Change read, starred, or star-color flags on messages.",
			annotations: WRITE,
			inputSchema: BulkUpdateFlagsInputSchema.shape,
		},
		async (input) =>
			asJson(await updateFlagsFor(deps.client, accountConfigId, input)),
	);
	server.registerTool(
		"update_message_labels",
		{
			description: "Apply or remove a label on messages.",
			annotations: WRITE,
			inputSchema: UpdateMessageLabelsInputSchema.shape,
		},
		async (input) =>
			asJson(await updateMessageLabelsFor(deps.client, accountConfigId, input)),
	);
	server.registerTool(
		"report_spam",
		{
			description:
				"Report messages as spam, block their senders, and move them to Junk.",
			annotations: WRITE,
			inputSchema: BulkMessageInputSchema.shape,
		},
		async (input) =>
			asJson(await reportSpamFor(deps.client, accountConfigId, userId, input)),
	);
	server.registerTool(
		"not_spam",
		{
			description: "Undo spam reports and move messages out of Junk.",
			annotations: WRITE,
			inputSchema: BulkMessageInputSchema.shape,
		},
		async (input) =>
			asJson(await notSpamFor(deps.client, accountConfigId, userId, input)),
	);
	server.registerTool(
		"empty_trash",
		{
			description:
				"Permanently delete all messages in an account's Trash folder.",
			annotations: DESTRUCTIVE,
			inputSchema: { accountId },
		},
		async ({ accountId }) =>
			asJson(await emptyTrashFor(deps.client, accountConfigId, accountId)),
	);
	server.registerTool(
		"appoint_folder_role",
		{
			description:
				"Appoint or clear the folder that fills a canonical account role.",
			annotations: WRITE,
			inputSchema: {
				accountId,
				role: CanonicalMailboxRoleSchema,
				...AppointFolderRoleInputSchema.shape,
			},
		},
		async ({ accountId, role, ...input }) =>
			asJson(
				await appointFolderRoleFor(
					deps.client,
					accountConfigId,
					accountId,
					role,
					input,
				),
			),
	);
	server.registerTool(
		"update_label",
		{
			description: "Change a label's name and color.",
			annotations: WRITE,
			inputSchema: {
				accountId,
				labelId,
				...UpdateLabelInputSchema.shape,
			},
		},
		async ({ accountId, labelId, ...input }) =>
			asJson(
				await updateLabelFor(
					deps.client,
					accountConfigId,
					accountId,
					labelId,
					input,
				),
			),
	);
	server.registerTool(
		"update_address",
		{
			description: "Set or clear saved flags for an address.",
			annotations: WRITE,
			inputSchema: { addressId, ...UpdateAddressInputSchema.shape },
		},
		async ({ addressId, ...input }) =>
			asJson(
				await updateAddressFor(deps.client, accountConfigId, addressId, input),
			),
	);
};
