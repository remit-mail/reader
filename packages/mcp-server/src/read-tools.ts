import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
	BodyPartItem,
	EnvelopeAddressItem,
	MessageItem,
	ThreadMessageItem,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import {
	AddressRole,
	ContentDisposition,
	MediaType,
} from "@remit/domain-enums";
import { z } from "zod";
import type { McpDeps } from "./deps.js";

export const MAX_BODY_BYTES = 20 * 1024;
const DEFAULT_PAGE_SIZE = 25;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const asJson = (value: unknown): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(value) }],
});

const pageSize = z
	.number()
	.int()
	.min(1)
	.max(100)
	.optional()
	.describe(`Page size, default ${DEFAULT_PAGE_SIZE}`);

const continuationToken = z
	.string()
	.optional()
	.describe("Opaque cursor from a previous response's continuationToken");

const order = z.enum(["asc", "desc"]).optional().describe("Sort order by date");

const toThreadRow = (row: ThreadMessageItem) => ({
	threadId: row.threadId,
	messageId: row.messageId,
	mailboxId: row.mailboxId,
	subject: row.subject,
	fromName: row.fromName,
	fromEmail: row.fromEmail,
	sentDate: row.sentDate,
	snippet: row.snippet,
	isRead: row.isRead,
	hasAttachment: row.hasAttachment,
	hasStars: row.hasStars,
});

const toPage = (result: {
	items: ThreadMessageItem[];
	continuationToken?: string;
}) => ({
	items: result.items.map(toThreadRow),
	continuationToken: result.continuationToken,
});

const owningAccountId = async (
	deps: McpDeps,
	accountConfigId: string,
	message: MessageItem,
): Promise<string> => {
	const accounts = await deps.account.listAllByAccountConfig(accountConfigId);
	const mailboxes = await Promise.all(
		accounts.map((account) =>
			deps.mailbox.get(account.accountId, [message.mailboxId]),
		),
	);
	const owner = mailboxes.flat()[0];
	if (!owner)
		throw new NotFoundError(`Message not found: ${message.messageId}`);
	return owner.accountId;
};

const addressesByRole = (addresses: EnvelopeAddressItem[], role: string) =>
	addresses
		.filter((address) => address.addressRole === role)
		.sort((left, right) => left.addressOrder - right.addressOrder)
		.map((address) => ({
			name: address.displayName,
			email: address.normalizedEmail,
		}));

const isPlainTextLeaf = (part: BodyPartItem): boolean =>
	!part.isMultipart &&
	part.mediaType === MediaType.Text &&
	part.mediaSubtype.toLowerCase() === "plain" &&
	part.disposition !== ContentDisposition.Attachment;

const truncateUtf8 = (text: string) => {
	const bytes = new TextEncoder().encode(text);
	if (bytes.length <= MAX_BODY_BYTES)
		return { bodyText: text, truncated: false };
	return {
		bodyText: new TextDecoder("utf-8", { fatal: false }).decode(
			bytes.slice(0, MAX_BODY_BYTES),
		),
		truncated: true,
	};
};

const readBodyText = async (
	deps: McpDeps,
	accountConfigId: string,
	accountId: string,
	message: MessageItem,
	parts: BodyPartItem[],
) => {
	if (!message.bodyStorageKey) return { bodyAvailable: false };
	await deps.bodySync.ensureBodyPartsStored(
		accountConfigId,
		accountId,
		message.messageId,
		message.bodyStorageKey,
	);
	const texts = await Promise.all(
		parts
			.filter(isPlainTextLeaf)
			.sort((left, right) => left.partPath.localeCompare(right.partPath))
			.map((part) =>
				deps.storage.retrieveBodyPart(
					accountConfigId,
					accountId,
					message.messageId,
					part.partPath,
				),
			),
	);
	const stored = texts.filter((text): text is Buffer => text !== null);
	if (stored.length === 0) return { bodyAvailable: true, bodyText: null };
	return {
		bodyAvailable: true,
		...truncateUtf8(stored.map((text) => text.toString("utf8")).join("\n\n")),
	};
};

export const registerReadTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
): void => {
	server.registerTool(
		"list_mailboxes",
		{
			description:
				"List the user's email accounts and the folders in each; use this to find the mailboxId other tools take.",
			inputSchema: {},
			annotations: READ_ONLY,
		},
		async () => {
			const accounts =
				await deps.account.listAllByAccountConfig(accountConfigId);
			const result = await Promise.all(
				accounts.map(async (account) => ({
					accountId: account.accountId,
					email: account.email,
					connectionState: account.connectionState,
					mailboxes: (
						await deps.mailbox.listAllByAccount(account.accountId)
					).map((mailbox) => ({
						mailboxId: mailbox.mailboxId,
						fullPath: mailbox.fullPath,
						specialUse: mailbox.specialUse ?? [],
						messageCount: mailbox.messageCount,
						unseenCount: mailbox.unseenCount,
					})),
				})),
			);
			return asJson({ accounts: result });
		},
	);

	server.registerTool(
		"list_threads",
		{
			description:
				"List the messages in one folder, newest first, a page at a time.",
			inputSchema: {
				mailboxId: z.string().min(1).describe("Folder from list_mailboxes"),
				limit: pageSize,
				continuationToken,
				order,
			},
			annotations: READ_ONLY,
		},
		async (args) =>
			asJson(
				toPage(
					await deps.threadMessage.listByMailbox(
						accountConfigId,
						args.mailboxId,
						{
							order: args.order ?? "desc",
							limit: args.limit ?? DEFAULT_PAGE_SIZE,
							continuationToken: args.continuationToken,
							excludeDeleted: true,
						},
					),
				),
			),
	);

	server.registerTool(
		"search_threads",
		{
			description:
				"Search the user's mail by free text, with optional sender, subject and state filters; narrow to one folder with mailboxId.",
			inputSchema: {
				query: z.string().trim().min(1).describe("Free-text search"),
				from: z.string().optional().describe("Sender address or name"),
				subject: z.string().optional().describe("Text in the subject"),
				mailboxId: z.string().optional().describe("Restrict to one folder"),
				unread: z.boolean().optional().describe("Only unread, or only read"),
				starred: z.boolean().optional().describe("Only starred"),
				attachments: z
					.boolean()
					.optional()
					.describe("Only with, or only without, attachments"),
				limit: pageSize,
				continuationToken,
				order,
			},
			annotations: READ_ONLY,
		},
		async (args) =>
			asJson(
				toPage(
					await deps.threadMessage.searchByDate(
						accountConfigId,
						{
							query: args.query,
							from: args.from,
							subject: args.subject,
							unread: args.unread,
							starred: args.starred,
							attachments: args.attachments,
						},
						{
							order: args.order ?? "desc",
							limit: args.limit ?? DEFAULT_PAGE_SIZE,
							continuationToken: args.continuationToken,
							mailboxIds: args.mailboxId
								? new Set([args.mailboxId])
								: undefined,
							excludeDeleted: true,
						},
					),
				),
			),
	);

	server.registerTool(
		"get_thread",
		{
			description:
				"Fetch the messages of one conversation, oldest first, at envelope level.",
			inputSchema: {
				threadId: z.string().min(1).describe("Thread to fetch"),
				limit: pageSize,
				continuationToken,
			},
			annotations: READ_ONLY,
		},
		async (args) =>
			asJson(
				toPage(
					await deps.threadMessage.listByThread(
						args.threadId,
						accountConfigId,
						{
							order: "asc",
							limit: args.limit ?? DEFAULT_PAGE_SIZE,
							continuationToken: args.continuationToken,
							excludeDeleted: true,
						},
					),
				),
			),
	);

	server.registerTool(
		"get_message",
		{
			description: `Read one message: envelope, flags, attachment metadata and its plain-text body, up to ${MAX_BODY_BYTES / 1024} KB.`,
			inputSchema: {
				messageId: z.string().min(1).describe("Message to read"),
			},
			annotations: READ_ONLY,
		},
		async (args) => {
			const message = await deps.message.get(args.messageId);
			const accountId = await owningAccountId(deps, accountConfigId, message);
			const description = await deps.message.describe(args.messageId);
			const envelope = description.envelope[0];
			const addresses = description.envelopeAddress;
			return asJson({
				messageId: message.messageId,
				mailboxId: message.mailboxId,
				date: envelope?.dateValue ?? message.internalDate,
				subject: envelope?.subject,
				from: addressesByRole(addresses, AddressRole.From),
				to: addressesByRole(addresses, AddressRole.To),
				cc: addressesByRole(addresses, AddressRole.Cc),
				replyTo: addressesByRole(addresses, AddressRole.ReplyTo),
				flags: description.messageFlag.map((flag) => flag.flagName),
				attachments: description.bodyPart
					.filter(
						(part) =>
							!part.isMultipart &&
							part.disposition === ContentDisposition.Attachment,
					)
					.map((part) => ({
						filename: part.dispositionFilename,
						mediaType: `${part.mediaType}/${part.mediaSubtype}`.toLowerCase(),
						sizeOctets: part.sizeOctets,
					})),
				...(await readBodyText(
					deps,
					accountConfigId,
					accountId,
					message,
					description.bodyPart,
				)),
			});
		},
	);
};
