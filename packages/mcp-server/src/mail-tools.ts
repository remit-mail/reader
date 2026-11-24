import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	CreateOutboxMessageInputSchema,
	InlineOutboxAttachmentInputSchema,
	OutboxMessageListResponseSchema,
	UpdateOutboxMessageInputSchema,
} from "@remit/api-zod-schemas";
import {
	completeOutboxAttachmentFor,
	createOutboxMessageFor,
	deleteOutboxMessageFor,
	getOutboxMessageFor,
	listOutboxMessagesFor,
	mintOutboxAttachmentFor,
	sendOutboxMessageFor,
	updateOutboxMessageFor,
} from "@remit/backend/outbox-operations";
import type { McpDeps } from "./deps.js";
import { asJson, toolError } from "./tool-result.js";

// Only server-defined reason codes travel back to the caller. Storage error
// bodies can also contain signed URLs, signatures, and other credentials.
const REASONS: Readonly<Record<string, string>> = {
	"not-an-attachment-key": "The upload URL does not name an attachment",
	"upload-signing-not-configured":
		"Attachment upload signing is not configured",
	missing: "The upload URL is missing its signature",
	malformed: "The upload URL is malformed",
	expired: "The upload URL has expired",
	"bad-signature": "The upload URL signature is invalid",
	"no-live-reservation": "The attachment has no live upload reservation",
	"over-reserved-size": "The attachment exceeds its reserved size",
	"size-mismatch": "The attachment size does not match its reservation",
	AccessDenied: "Storage denied access to the attachment upload",
	ExpiredToken: "The storage upload token has expired",
	RequestExpired: "The upload URL has expired",
	SignatureDoesNotMatch: "The upload URL signature is invalid",
	EntityTooLarge: "The attachment exceeds the storage size limit",
	InvalidAccessKeyId: "The storage access key is invalid",
	InvalidToken: "The storage upload token is invalid",
};

export const MCP_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

const outboxMessageId = CreateOutboxMessageInputSchema.shape.accountId.describe(
	"Outbox message identifier",
);
const outboxAttachmentId =
	CreateOutboxMessageInputSchema.shape.accountId.describe(
		"Outbox attachment identifier",
	);
const createOutboxMessageInput = CreateOutboxMessageInputSchema.omit({
	sendImmediately: true,
});
const continuationToken =
	OutboxMessageListResponseSchema.shape.continuationToken
		.unwrap()
		.describe("Continuation token from the prior page, or an empty string");
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	openWorldHint: false,
} as const;
const DELETE = { ...WRITE, destructiveHint: true } as const;

export const registerMailTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
): void => {
	server.registerTool(
		"create_outbox_message",
		{
			description: "Create a draft message.",
			inputSchema: createOutboxMessageInput.shape,
			annotations: WRITE,
		},
		async (input) =>
			asJson(
				await createOutboxMessageFor(
					deps.client,
					deps.apiConfig,
					accountConfigId,
					input,
				),
			),
	);
	server.registerTool(
		"list_outbox_messages",
		{
			description: "List draft, queued, sent, and failed outgoing messages.",
			inputSchema: { continuationToken },
			annotations: READ_ONLY,
		},
		async ({ continuationToken }) =>
			asJson(
				await listOutboxMessagesFor(
					deps.client,
					deps.apiConfig,
					accountConfigId,
					continuationToken || undefined,
				),
			),
	);
	server.registerTool(
		"get_outbox_message",
		{
			description: "Get one outgoing message and its attachments.",
			inputSchema: { outboxMessageId },
			annotations: READ_ONLY,
		},
		async ({ outboxMessageId }) =>
			asJson(
				await getOutboxMessageFor(
					deps.client,
					deps.apiConfig,
					accountConfigId,
					outboxMessageId,
				),
			),
	);
	server.registerTool(
		"update_outbox_message",
		{
			description: "Change a draft message and the attachments it keeps.",
			inputSchema: {
				outboxMessageId,
				...UpdateOutboxMessageInputSchema.shape,
			},
			annotations: WRITE,
		},
		async ({ outboxMessageId, ...input }) =>
			asJson(
				await updateOutboxMessageFor(
					deps.client,
					deps.apiConfig,
					accountConfigId,
					outboxMessageId,
					input,
				),
			),
	);
	server.registerTool(
		"delete_outbox_message",
		{
			description: "Delete a draft or failed outgoing message.",
			inputSchema: { outboxMessageId },
			annotations: DELETE,
		},
		async ({ outboxMessageId }) => {
			await deleteOutboxMessageFor(
				deps.client,
				accountConfigId,
				outboxMessageId,
			);
			return asJson({ deleted: true, outboxMessageId });
		},
	);
	server.registerTool(
		"send_outbox_message",
		{
			description: "Queue a draft message for sending.",
			inputSchema: { outboxMessageId },
			annotations: { ...WRITE, openWorldHint: true },
		},
		async ({ outboxMessageId }) =>
			asJson(
				await sendOutboxMessageFor(
					deps.client,
					deps.apiConfig,
					accountConfigId,
					outboxMessageId,
				),
			),
	);
	server.registerTool(
		"mint_outbox_attachment",
		{
			description:
				"Reserve and upload one attachment supplied as base64, up to 5 MiB. Complete it with complete_outbox_attachment before sending.",
			inputSchema: {
				outboxMessageId,
				...InlineOutboxAttachmentInputSchema.shape,
			},
			annotations: WRITE,
		},
		async ({ outboxMessageId, filename, contentType, contentBase64 }) => {
			const content = Uint8Array.from(atob(contentBase64), (character) =>
				character.charCodeAt(0),
			);
			if (content.byteLength > MCP_ATTACHMENT_MAX_BYTES) {
				return toolError("Attachment exceeds the 5 MiB inline size limit.");
			}
			const minted = await mintOutboxAttachmentFor(
				deps.client,
				accountConfigId,
				outboxMessageId,
				{ filename, contentType, sizeBytes: content.byteLength },
			);
			if ("body" in minted) return toolError(minted.body.message);
			const uploaded = await fetch(minted.uploadUrl, {
				method: "PUT",
				body: content,
			});
			if (!uploaded.ok) {
				const body = await uploaded.text();
				const code =
					uploaded.headers.get("x-remit-upload-reason") ??
					/<Code>([^<]+)<\/Code>/.exec(body)?.[1] ??
					body.trim();
				const reason = Object.hasOwn(REASONS, code)
					? REASONS[code]
					: "The storage server refused the upload";
				throw new Error(
					`Attachment upload failed with status ${uploaded.status}: ${reason}`,
				);
			}
			return asJson(minted);
		},
	);
	server.registerTool(
		"complete_outbox_attachment",
		{
			description:
				"Confirm that an attachment upload is stored and ready to send.",
			inputSchema: { outboxMessageId, outboxAttachmentId },
			annotations: WRITE,
		},
		async ({ outboxMessageId, outboxAttachmentId }) => {
			const completed = await completeOutboxAttachmentFor(
				deps.client,
				deps.apiConfig,
				accountConfigId,
				outboxMessageId,
				outboxAttachmentId,
			);
			return "body" in completed
				? toolError(completed.body.message)
				: asJson(completed);
		},
	);
};
