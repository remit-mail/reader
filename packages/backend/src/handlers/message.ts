import { inspect } from "node:util";
import { SQSClient } from "@aws-sdk/client-sqs";
import { SenderTrust, StarColor } from "@remit/domain-enums";
import type {
	BodyPartResponse,
	EnvelopeAddressResponse,
	EnvelopeResponse,
	MessageSummaryResponse,
} from "@remit/api-openapi-types";
import {
	enqueueSearchIndexEvents,
	type IndexEvent,
} from "@remit/search-index-worker";
import {
	isStorageNotFoundError as isStorageNotFoundErrorFromService,
	parseStorageUri,
	type StorageService,
} from "@remit/storage-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { simpleParser } from "mailparser";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import { deriveSenderTrust } from "../derive/senderTrust.js";
import { logger } from "../logger.js";
import { getClient } from "../service/dynamodb.js";
import type {
	MessageBulkOperationIds,
	MessageOperationIds,
	OperationHandler,
} from "../types.js";

type StarColorValue = (typeof StarColor)[keyof typeof StarColor];

let _searchSqs: SQSClient | undefined;
const getSearchIndexSqs = (): SQSClient => {
	if (!_searchSqs) _searchSqs = new SQSClient({});
	return _searchSqs;
};

const getSearchIndexQueueUrl = (): string | undefined =>
	process.env.SQS_QUEUE_URL_SEARCH_INDEX;

export const isStorageNotFoundError = (error: unknown): boolean =>
	isStorageNotFoundErrorFromService(error);

/**
 * Extract the accountConfigId + accountId segments from a bodyStorageKey URI
 * such as
 * `s3://bucket/accounts/{accountConfigId}/{accountId}/messages/{messageId}/body.eml`.
 * Returns null when the URI shape doesn't match — caller falls back to the
 * slow path without writing a parsed-body cache.
 */
export const extractAccountIdsFromBodyKey = (
	uri: string,
): { accountConfigId: string; accountId: string } | null => {
	const parsed = parseStorageUri(uri);
	const match = parsed.storageKey.match(
		/^accounts\/([^/]+)\/([^/]+)\/messages\//,
	);
	if (!match) return null;
	return { accountConfigId: match[1], accountId: match[2] };
};

export interface BodyContent {
	bodyText: string | undefined;
	bodyHtml: string | undefined;
}

/**
 * Fetch parsed body content for a message from storage with parsed-body caching.
 *
 * Tries the parsed.json.gz cache first (fast path). On miss, retrieves the raw
 * .eml, runs mailparser, then writes parsed.json.gz opportunistically so the
 * next read is fast. Cache-write failures are logged and swallowed — they must
 * never fail the user's read.
 *
 * Returns null when the body is not in storage at all (caller should fall
 * back to fetching from IMAP).
 */
export const fetchBodyFromStorage = async (
	storage: StorageService,
	messageId: string,
	bodyStorageKey: string,
): Promise<BodyContent | null> => {
	const ids = extractAccountIdsFromBodyKey(bodyStorageKey);

	if (ids) {
		const cached = await storage.retrieveParsedBody(
			ids.accountConfigId,
			ids.accountId,
			messageId,
		);
		if (cached) {
			return {
				bodyText: cached.text ?? undefined,
				bodyHtml: cached.html ?? undefined,
			};
		}
	}

	const rawBody = await storage
		.retrieve(bodyStorageKey)
		.catch((error: unknown) => {
			if (isStorageNotFoundError(error)) return undefined;
			throw error;
		});

	if (!rawBody) return null;

	const parsed = await simpleParser(rawBody);
	const bodyText = parsed.text ?? undefined;
	const bodyHtml = typeof parsed.html === "string" ? parsed.html : undefined;

	if (ids) {
		await storage
			.storeParsedBody({
				accountConfigId: ids.accountConfigId,
				accountId: ids.accountId,
				messageId,
				parsed: {
					text: parsed.text ?? null,
					html: typeof parsed.html === "string" ? parsed.html : null,
					attachments: (parsed.attachments ?? []).map((a) => ({
						filename: a.filename ?? null,
						contentType: a.contentType,
						contentDisposition: a.contentDisposition ?? null,
						contentId: a.contentId ?? null,
						size: a.size,
					})),
				},
			})
			.catch((err: unknown) => {
				console.error(
					`[describeMessage] parsed-body cache write failed for ${messageId}:`,
					inspect(err),
				);
			});
	}

	return { bodyText, bodyHtml };
};

export const MessageOperations: Record<
	MessageOperationIds,
	OperationHandler<MessageOperationIds>
> = {
	MessageOperations_describeMessage: async (
		context: Context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { messageId } = context.request.params as { messageId: string };
		const description = await getClient().message.describe(messageId);

		const message = description.message[0];
		const envelope = description.envelope[0];

		const messageSummary: MessageSummaryResponse = {
			messageId: message.messageId,
			mailboxId: message.mailboxId,
			uid: message.uid,
			rfc822Size: message.rfc822Size,
			internalDate: message.internalDate,
			messageIdHeader: message.messageIdHeader,
		};

		// Batch-fetch the resolved Address rows so each EnvelopeAddressResponse can
		// carry the sender-level `flags` map. Without this the From-line UI would
		// need a second round-trip to render trust state on every message open.
		const uniqueAddressIds = Array.from(
			new Set(description.envelopeAddress.map((a) => a.addressId)),
		);
		const addresses = uniqueAddressIds.length
			? await getClient().address.getAddress(uniqueAddressIds)
			: [];
		const flagsByAddressId = new Map(
			addresses.map((a) => [a.addressId, a.flags]),
		);

		const groupedAddresses = description.envelopeAddress.reduce(
			(acc, addr) => {
				const role = addr.addressRole;
				if (!acc[role]) acc[role] = [];
				acc[role].push({
					addressId: addr.addressId,
					displayName: addr.displayName,
					normalizedEmail: addr.normalizedEmail,
					addressRole: addr.addressRole,
					addressOrder: addr.addressOrder,
					flags: flagsByAddressId.get(addr.addressId),
				});
				return acc;
			},
			{} as Record<string, EnvelopeAddressResponse[]>,
		);

		const fromAddress = groupedAddresses.from?.[0];
		const fromFlags = fromAddress
			? flagsByAddressId.get(fromAddress.addressId)
			: undefined;
		const senderTrust = fromAddress
			? deriveSenderTrust(fromFlags)
			: SenderTrust.Unknown;

		const envelopeResponse: EnvelopeResponse = {
			messageId: envelope?.messageId ?? messageId,
			date: envelope?.dateValue ?? message.internalDate,
			subject: envelope?.subject,
			messageIdValue: envelope?.messageIdValue,
			from: groupedAddresses.from ?? [],
			to: groupedAddresses.to ?? [],
			cc: groupedAddresses.cc ?? [],
			bcc: groupedAddresses.bcc ?? [],
			replyTo: groupedAddresses.reply_to ?? [],
			category: message.category,
			senderTrust,
		};

		const bodyParts: BodyPartResponse[] = description.bodyPart.map((part) => ({
			bodyPartId: part.bodyPartId,
			mediaType: part.mediaType,
			mediaSubtype: part.mediaSubtype,
			sizeOctets: part.sizeOctets,
			disposition: part.disposition,
			dispositionFilename: part.dispositionFilename,
			isMultipart: part.isMultipart,
		}));

		const flags = description.messageFlag.map((f) => f.flagName);

		// Fetch body content from storage if available.
		//
		// Fast path: parsed.json.gz cache hit -> 1 S3 GET, gunzip, JSON.parse.
		// Slow path: cache miss -> retrieve raw .eml, run mailparser, then
		// opportunistically write parsed.json.gz so subsequent reads are fast.
		let bodyText: string | undefined;
		let bodyHtml: string | undefined;

		const client = getClient();

		const fromStorage = message.bodyStorageKey
			? await fetchBodyFromStorage(
					client.storage,
					messageId,
					message.bodyStorageKey,
				)
			: null;

		if (fromStorage) {
			bodyText = fromStorage.bodyText;
			bodyHtml = fromStorage.bodyHtml;
		} else {
			// Fall back to on-demand IMAP fetch. fetchAndGetBody now writes
			// parsed.json.gz alongside the raw .eml on its own.
			// accountConfigId comes from the JWT; mailbox.get is kept because
			// fullPath + accountId are needed for the IMAP connection.
			const mailbox = await client.mailbox.get(message.mailboxId);
			const scope = await client.createConnectionScope(mailbox.accountId);

			const result = await client.bodySync
				.fetchAndGetBody(
					messageId,
					mailbox.accountId,
					accountConfigId,
					mailbox.fullPath,
					scope.getConnection,
				)
				.finally(() => scope.disconnect());

			bodyText = result.text ?? undefined;
			bodyHtml = result.html ?? undefined;

			// Body fetched from IMAP and stored — enqueue search index upsert (best-effort).
			const searchQueueUrl = getSearchIndexQueueUrl();
			if (searchQueueUrl) {
				const upsertEvents: IndexEvent[] = [
					{
						type: "upsert" as const,
						messageId,
						accountId: mailbox.accountId,
						accountConfigId,
						mailboxIds: [message.mailboxId],
					},
				];
				await enqueueSearchIndexEvents(
					getSearchIndexSqs(),
					searchQueueUrl,
					upsertEvents,
				).catch((err: unknown) => {
					logger.warn(
						{ error: inspect(err), messageId },
						"Failed to enqueue search index upsert (best-effort)",
					);
				});
			}
		}

		const references = description.messageReference.map((ref) => ({
			messageIdValue: ref.messageIdValue,
			referenceType: ref.referenceType,
			referenceOrder: ref.referenceOrder,
		}));

		return {
			message: messageSummary,
			envelope: envelopeResponse,
			flags,
			bodyParts,
			references,
			bodyText,
			bodyHtml,
		};
	},

	MessageOperations_updateMessageFlags: async (context) => {
		const { messageId } = context.request.params as { messageId: string };
		const { isRead, isStarred, starColor } = context.request.requestBody as {
			isRead?: boolean;
			isStarred?: boolean;
			starColor?: string;
		};

		const client = getClient();

		// Resolve accountId from message -> mailbox
		const message = await client.message.get(messageId);
		const mailbox = await client.mailbox.get(message.mailboxId);

		// FlagQueueService handles: MessageFlag + ThreadMessage updates + SQS event
		const result = await client.flagQueue.updateFlags(
			messageId,
			mailbox.accountId,
			{ isRead, isStarred, starColor: starColor as StarColorValue | undefined },
		);

		return {
			messageId: result.messageId,
			isRead: result.isRead,
			isStarred: result.isStarred,
		};
	},
};

export const MessageBulkOperations: Record<
	MessageBulkOperationIds,
	OperationHandler<MessageBulkOperationIds>
> = {
	MessageBulkOperations_updateFlags: async (context) => {
		const { messageIds, isRead, isStarred, starColor } = context.request
			.requestBody as {
			messageIds: string[];
			isRead?: boolean;
			isStarred?: boolean;
			starColor?: string;
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = getClient();

		// Resolve accountId from first message -> mailbox
		const message = await client.message.get(messageIds[0]);
		const mailbox = await client.mailbox.get(message.mailboxId);

		// FlagQueueService handles: MessageFlag + ThreadMessage updates + SQS events
		// Process each message individually (same pattern as moveMessages)
		for (const messageId of messageIds) {
			await client.flagQueue.updateFlags(messageId, mailbox.accountId, {
				isRead,
				isStarred,
				starColor: starColor as StarColorValue | undefined,
			});
		}

		return {
			successCount: messageIds.length,
			failureCount: 0,
		};
	},

	MessageBulkOperations_deleteMessages: async (context) => {
		const { messageIds, permanent } = context.request.requestBody as {
			messageIds: string[];
			permanent?: boolean;
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = getClient();

		// Resolve accountId from first message -> mailbox
		const message = await client.message.get(messageIds[0]);
		const mailbox = await client.mailbox.get(message.mailboxId);

		// MessageMoveService handles: Message + ThreadMessage updates + SQS events
		await client.messageMove.deleteMessages(messageIds, mailbox.accountId, {
			permanent,
		});

		// Enqueue delete events for the async search index worker (best-effort).
		// #214: replaced inline wipeSearchVectors with SQS enqueue.
		const searchQueueUrl = getSearchIndexQueueUrl();
		if (searchQueueUrl) {
			const events: IndexEvent[] = messageIds.map((id) => ({
				type: "delete" as const,
				messageId: id,
			}));
			await enqueueSearchIndexEvents(
				getSearchIndexSqs(),
				searchQueueUrl,
				events,
			).catch((error: unknown) => {
				logger.warn(
					{ error: inspect(error) },
					"Failed to enqueue search index delete events (best-effort)",
				);
			});
		}

		return {
			successCount: messageIds.length,
			failureCount: 0,
		};
	},

	MessageBulkOperations_moveMessages: async (context) => {
		const { messageIds, destinationMailboxId } = context.request
			.requestBody as {
			messageIds: string[];
			destinationMailboxId: string;
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = getClient();

		// Verify destination mailbox exists
		await client.mailbox.get(destinationMailboxId);

		// Resolve accountId from first message -> mailbox
		const message = await client.message.get(messageIds[0]);
		const mailbox = await client.mailbox.get(message.mailboxId);

		// MessageMoveService handles: Message + ThreadMessage updates + SQS events
		await client.messageMove.moveMessages(
			messageIds,
			destinationMailboxId,
			mailbox.accountId,
		);

		return {
			successCount: messageIds.length,
			failureCount: 0,
		};
	},

	MessageBulkOperations_copyMessages: async (context) => {
		const { messageIds, destinationMailboxId } = context.request
			.requestBody as {
			messageIds: string[];
			destinationMailboxId: string;
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = getClient();

		// Verify destination mailbox exists
		await client.mailbox.get(destinationMailboxId);

		// Resolve accountId from first message -> mailbox
		const message = await client.message.get(messageIds[0]);
		const mailbox = await client.mailbox.get(message.mailboxId);

		// MessageMoveService handles: Message copies + ThreadMessage creation + SQS events
		await client.messageMove.copyMessages(
			messageIds,
			destinationMailboxId,
			mailbox.accountId,
		);

		return {
			successCount: messageIds.length,
			failureCount: 0,
		};
	},
};
