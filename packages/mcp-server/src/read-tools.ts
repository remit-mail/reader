import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { deriveAutoMoved } from "@remit/backend/auto-moved";
import { deriveSenderTrust } from "@remit/backend/sender-trust";
import type {
	BodyPartItem,
	EnvelopeAddressItem,
	MessageItem,
	ThreadMessageItem,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { deriveAddressId } from "@remit/data-ports/id";
import {
	AddressRole,
	ContentDisposition,
	MediaType,
} from "@remit/domain-enums";
import {
	materializeBodyParts,
	ownedMessages,
	readClassifierStats,
	sentDateRange,
} from "@remit/mailbox-service";
import { z } from "zod";
import type { McpDeps } from "./deps.js";
import { operationTool } from "./operation-tool.js";
import { refused, toolError } from "./tool-result.js";

export const MAX_BODY_BYTES = 20 * 1024;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const asJson = (value: unknown): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(value) }],
});

const pageSize = z
	.number()
	.int()
	.min(1)
	.max(MAX_PAGE_SIZE)
	.optional()
	.describe(
		`Page size, default ${DEFAULT_PAGE_SIZE}, at most ${MAX_PAGE_SIZE}`,
	);

const continuationToken = z
	.string()
	.optional()
	.describe("Opaque cursor from a previous response's continuationToken");

const order = z.enum(["asc", "desc"]).optional().describe("Sort order by date");

const before = z
	.string()
	.optional()
	.describe(
		"Only messages dated before this, an ISO 8601 date-time with zone offset such as 2026-08-13T00:00:00+02:00",
	);

const after = z
	.string()
	.optional()
	.describe(
		"Only messages dated at or after this, an ISO 8601 date-time with zone offset",
	);

type ScoreDetail = "All" | "Confident";

const classificationOf = (message: MessageItem, detail: ScoreDetail) => ({
	classificationState: message.classificationState,
	category: message.category,
	scores:
		detail === "All"
			? message.classifierScores
			: message.classifierScores.filter((score) => score.confident),
});

const authOf = (message: MessageItem) =>
	message.authResult === undefined
		? { state: "NotParsed" as const }
		: { state: "Parsed" as const, ...message.authResult };

const toThreadRow = (
	row: ThreadMessageItem,
	message: MessageItem,
	detail: ScoreDetail,
) => ({
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
	classification: classificationOf(message, detail),
	auth: authOf(message),
});

const withMessages = async (deps: McpDeps, rows: ThreadMessageItem[]) => {
	const messages = new Map(
		(await deps.message.get(rows.map((row) => row.messageId))).map(
			(message) => [message.messageId, message],
		),
	);
	const missing = rows
		.map((row) => row.messageId)
		.filter((messageId) => !messages.has(messageId));
	if (missing.length > 0) {
		throw new NotFoundError(`Message not found: ${missing.join(", ")}`);
	}
	return rows.flatMap((row) => {
		const message = messages.get(row.messageId);
		return message === undefined ? [] : [{ row, message }];
	});
};

const toPage = async (
	deps: McpDeps,
	result: {
		items: ThreadMessageItem[];
		continuationToken?: string;
	},
	detail: ScoreDetail,
) => ({
	items: (await withMessages(deps, result.items)).map(({ row, message }) =>
		toThreadRow(row, message, detail),
	),
	continuationToken: result.continuationToken,
});

type Placed = { message: MessageItem; fromEmail: string | undefined };

const labelsOf = async (
	deps: McpDeps,
	accountConfigId: string,
	messageIds: string[],
) => {
	const messageLabels = await deps.messageLabel.listByMessageIds(messageIds);
	const labels = await Promise.all(
		[...new Set(messageLabels.map((applied) => applied.labelId))].map(
			(labelId) =>
				deps.label.get(accountConfigId, labelId).catch((error: unknown) => {
					if (error instanceof NotFoundError) return undefined;
					throw error;
				}),
		),
	);
	const labelById = new Map(
		labels.flatMap((label) =>
			label === undefined ? [] : [[label.labelId, label] as const],
		),
	);
	return (messageId: string) =>
		messageLabels.flatMap((applied) => {
			const label = labelById.get(applied.labelId);
			return applied.messageId !== messageId || label === undefined
				? []
				: [{ labelId: label.labelId, name: label.name, color: label.color }];
		});
};

const placementOf = async (
	deps: McpDeps,
	accountConfigId: string,
	placed: Placed[],
) => {
	const addressIdOf = (fromEmail: string | undefined) =>
		fromEmail ? deriveAddressId(accountConfigId, fromEmail) : undefined;
	const addressIds = [
		...new Set(
			placed.flatMap(({ fromEmail }) => {
				const addressId = addressIdOf(fromEmail);
				return addressId === undefined ? [] : [addressId];
			}),
		),
	];
	const [addresses, labelsFor] = await Promise.all([
		addressIds.length === 0
			? []
			: deps.address.getAddress(accountConfigId, addressIds),
		labelsOf(
			deps,
			accountConfigId,
			placed.map(({ message }) => message.messageId),
		),
	]);
	const flagsByAddressId = new Map(
		addresses.map((address) => [address.addressId, address.flags]),
	);
	return placed.map(({ message, fromEmail }) => {
		const addressId = addressIdOf(fromEmail);
		const flags =
			addressId === undefined ? undefined : flagsByAddressId.get(addressId);
		const verdict = message.placementVerdict;
		return {
			spamVerdict: message.spamVerdict,
			spamCleared: message.spamCleared,
			placementVerdict:
				verdict === undefined
					? undefined
					: {
							action: verdict.action,
							fromPlacement: verdict.fromPlacement,
							reasons: verdict.reasons,
						},
			autoMoved: deriveAutoMoved(message),
			spamReport: message.spamReport,
			labels: labelsFor(message.messageId),
			sender: {
				trust: deriveSenderTrust(flags),
				blocked: flags?.blocked?.value === true,
				neverSpam: flags?.neverSpam?.value === true,
			},
		};
	});
};

const PLACEMENT_FIELDS =
	"why it sits where it does: the spam verdict (score, action, reasons, decidedBy, modelOutcome), Remit's placement verdict (action, fromPlacement, reasons) and autoMoved (the move Remit made, with the filterId when a filter made it), a user spam report and whether the user cleared it (spamCleared), labels, and the sender's trust (Vip, Wellknown or Unknown) with its blocked and neverSpam flags";

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

const readPlainText = async (
	deps: McpDeps,
	accountConfigId: string,
	accountId: string,
	messageId: string,
	parts: BodyPartItem[],
) => {
	const texts = await Promise.all(
		parts
			.filter(isPlainTextLeaf)
			.sort((left, right) => left.partPath.localeCompare(right.partPath))
			.map((part) =>
				deps.storage.retrieveBodyPart(
					accountConfigId,
					accountId,
					messageId,
					part.partPath,
				),
			),
	);
	const stored = texts.filter((text): text is Buffer => text !== null);
	if (stored.length === 0) return { bodyText: null };
	return truncateUtf8(stored.map((text) => text.toString("utf8")).join("\n\n"));
};

export const registerReadTools = (
	server: McpServer,
	deps: McpDeps,
	accountConfigId: string,
): void => {
	operationTool(server, [
		"MailboxOperations_listMailboxes",
		"MailboxDetailOperations_getMailbox",
	]).registerTool(
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

	operationTool(server, [
		"ThreadOperations_listThreads",
		"UnifiedThreadOperations_listAllThreads",
	]).registerTool(
		"list_threads",
		{
			description:
				"List the messages in one folder, newest first, a page at a time; before and after narrow it to a date range.",
			inputSchema: {
				mailboxId: z.string().min(1).describe("Folder from list_mailboxes"),
				before,
				after,
				limit: pageSize,
				continuationToken,
				order,
			},
			annotations: READ_ONLY,
		},
		async (args) => {
			const sent = sentDateRange(args);
			if (!sent.ok) return refused(sent.refusal);
			return asJson(
				await toPage(
					deps,
					await deps.threadMessage.searchByDate(accountConfigId, sent.value, {
						order: args.order ?? "desc",
						limit: args.limit ?? DEFAULT_PAGE_SIZE,
						continuationToken: args.continuationToken,
						mailboxIds: new Set([args.mailboxId]),
						excludeDeleted: true,
					}),
					"Confident",
				),
			);
		},
	);

	operationTool(server, ["ThreadOperations_searchThreads"]).registerTool(
		"search_threads",
		{
			description:
				"Search the user's mail by free text, with optional sender, subject, state and date filters; narrow to one folder with mailboxId.",
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
				before,
				after,
				limit: pageSize,
				continuationToken,
				order,
			},
			annotations: READ_ONLY,
		},
		async (args) => {
			const sent = sentDateRange(args);
			if (!sent.ok) return refused(sent.refusal);
			return asJson(
				await toPage(
					deps,
					await deps.threadMessage.searchByDate(
						accountConfigId,
						{
							...sent.value,
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
					"Confident",
				),
			);
		},
	);

	operationTool(server, [
		"ThreadDetailOperations_listThreadMessages",
	]).registerTool(
		"get_thread",
		{
			description: `Fetch the messages of one conversation, oldest first, at envelope level, each with ${PLACEMENT_FIELDS}.`,
			inputSchema: {
				threadId: z.string().min(1).describe("Thread to fetch"),
				limit: pageSize,
				continuationToken,
			},
			annotations: READ_ONLY,
		},
		async (args) => {
			const result = await deps.threadMessage.listByThread(
				args.threadId,
				accountConfigId,
				{
					order: "asc",
					limit: args.limit ?? DEFAULT_PAGE_SIZE,
					continuationToken: args.continuationToken,
					excludeDeleted: true,
				},
			);
			const rows = await withMessages(deps, result.items);
			const placement = await placementOf(
				deps,
				accountConfigId,
				rows.map(({ row, message }) => ({ message, fromEmail: row.fromEmail })),
			);
			return asJson({
				items: rows.map(({ row, message }, index) => ({
					...toThreadRow(row, message, "All"),
					...placement[index],
				})),
				continuationToken: result.continuationToken,
			});
		},
	);

	operationTool(server, [
		"ClassificationStatsOperations_getClassificationStats",
	]).registerTool(
		"classifier_stats",
		{
			description:
				"Count what the classifier decided for mail that arrived on or after a date: messages examined, messages per category, confident scores per label, and how often the user corrected it.",
			inputSchema: {
				since: z
					.string()
					.min(1)
					.describe(
						"Start of the window, an ISO 8601 date-time with zone offset, such as 2026-11-01T00:00:00+01:00",
					),
			},
			annotations: READ_ONLY,
		},
		async (args) => {
			const stats = await readClassifierStats(
				deps,
				accountConfigId,
				args.since,
			);
			if (!stats.ok) return toolError(`${stats.message}.`);
			return asJson(stats.value);
		},
	);

	operationTool(server, ["MessageOperations_describeMessage"]).registerTool(
		"get_message",
		{
			description: `Read one message: envelope, flags, attachment metadata, its plain-text body up to ${MAX_BODY_BYTES / 1024} KB, and ${PLACEMENT_FIELDS}.`,
			inputSchema: {
				messageId: z.string().min(1).describe("Message to read"),
			},
			annotations: READ_ONLY,
		},
		async (args) => {
			const owned = await ownedMessages(
				deps,
				[args.messageId],
				accountConfigId,
				"read",
			);
			if (!owned.ok) {
				throw new NotFoundError(`Message not found: ${args.messageId}`);
			}
			const accountId = owned.value;
			const message = await deps.message.get(args.messageId);
			const description = await deps.message.describe(args.messageId);
			const materialized = await materializeBodyParts(deps.bodySync, {
				accountConfigId,
				accountId,
				mailboxId: message.mailboxId,
				messageId: message.messageId,
				uid: message.uid,
				bodyStorageKey: message.bodyStorageKey,
				cue: deps.bodySyncQueue,
				logger: deps.logger,
			});
			const bodyAvailable =
				Boolean(message.bodyStorageKey) && materialized.ready;
			const envelope = description.envelope[0];
			const addresses = description.envelopeAddress;
			const [placement] = await placementOf(deps, accountConfigId, [
				{
					message,
					fromEmail: addressesByRole(addresses, AddressRole.From)[0]?.email,
				},
			]);
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
				...placement,
				bodyAvailable,
				...(bodyAvailable
					? await readPlainText(
							deps,
							accountConfigId,
							accountId,
							message.messageId,
							description.bodyPart,
						)
					: {}),
			});
		},
	);
};
