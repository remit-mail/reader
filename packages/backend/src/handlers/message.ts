import {
	ContentDisposition,
	MediaType,
	SenderTrust,
	StarColor,
} from "@remit/domain-enums";
import type {
	BodyPartResponse,
	EnvelopeAddressResponse,
	EnvelopeResponse,
	MessageSummaryResponse,
} from "@remit/api-openapi-types";
import {
	isStorageNotFoundError as isStorageNotFoundErrorFromService,
	parseStorageUri,
} from "@remit/storage-service";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getAccountConfigIdFromEvent } from "../auth.js";
import {
	buildContentUrl,
	getContentDeliveryDomain,
} from "../derive/contentUrl.js";
import { deriveSenderTrust } from "../derive/senderTrust.js";
import { logger } from "../logger.js";
import { getClient } from "../service/dynamodb.js";
import type {
	MessageBulkOperationIds,
	MessageOperationIds,
	OperationHandler,
} from "../types.js";
import { assertAccountOwnership } from "./account-ownership.js";

type StarColorValue = (typeof StarColor)[keyof typeof StarColor];

export const isStorageNotFoundError = (error: unknown): boolean =>
	isStorageNotFoundErrorFromService(error);

/**
 * Decode the raw `.eml` bytes into a string for inspection. RFC822/MIME
 * sources are 7-bit/8-bit ASCII-compatible (non-ASCII bytes are encoded via
 * quoted-printable / base64 inside the body), so `latin1` round-trips every
 * byte 1:1 without loss or replacement characters — unlike `utf8`, which would
 * mangle raw 8-bit bytes. Headers and structure stay byte-accurate.
 */
export const decodeRawEml = (body: Buffer): string => body.toString("latin1");

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

/**
 * Map a list of stored `BodyPart` rows to API `BodyPartResponse` objects,
 * populating `contentUrl` from the CloudFront distribution domain. Pure
 * function so the URL-construction contract can be pinned in tests without
 * standing up the full handler. The contract requires every `contentUrl`
 * to be a real URL (#299) — `getContentDeliveryDomain` throws when the
 * Lambda env is missing the domain, and this function expects a non-empty
 * string from the caller.
 */
export interface BodyPartLike {
	bodyPartId: string;
	mediaType: string;
	mediaSubtype: string;
	sizeOctets: number;
	disposition?: string;
	dispositionFilename?: string;
	isMultipart: boolean;
	contentId?: string;
	partPath: string;
}

const MEDIA_TYPE_VALUES: ReadonlySet<string> = new Set(
	Object.values(MediaType),
);
const CONTENT_DISPOSITION_VALUES: ReadonlySet<string> = new Set(
	Object.values(ContentDisposition),
);

export const isMediaType = (
	value: unknown,
): value is BodyPartResponse["mediaType"] =>
	typeof value === "string" && MEDIA_TYPE_VALUES.has(value);

export const isContentDisposition = (
	value: unknown,
): value is NonNullable<BodyPartResponse["disposition"]> =>
	typeof value === "string" && CONTENT_DISPOSITION_VALUES.has(value);

const assertMediaType = (
	value: string,
	bodyPartId: string,
): BodyPartResponse["mediaType"] => {
	if (!isMediaType(value)) {
		throw new Error(
			`Invalid mediaType "${value}" on BodyPart ${bodyPartId}; expected one of ${[...MEDIA_TYPE_VALUES].join(", ")}`,
		);
	}
	return value;
};

const assertDisposition = (
	value: string | undefined,
	bodyPartId: string,
): BodyPartResponse["disposition"] => {
	if (value === undefined) return undefined;
	if (!isContentDisposition(value)) {
		throw new Error(
			`Invalid disposition "${value}" on BodyPart ${bodyPartId}; expected one of ${[...CONTENT_DISPOSITION_VALUES].join(", ")}`,
		);
	}
	return value;
};

export const buildBodyPartResponses = (
	parts: readonly BodyPartLike[],
	context: {
		contentDeliveryDomain: string;
		accountConfigId: string;
		accountId: string;
		messageId: string;
	},
): BodyPartResponse[] => {
	return parts.map((part) => ({
		bodyPartId: part.bodyPartId,
		mediaType: assertMediaType(part.mediaType, part.bodyPartId),
		mediaSubtype: part.mediaSubtype,
		sizeOctets: part.sizeOctets,
		disposition: assertDisposition(part.disposition, part.bodyPartId),
		dispositionFilename: part.dispositionFilename,
		isMultipart: part.isMultipart,
		contentId: part.contentId,
		contentUrl: buildContentUrl({
			domain: context.contentDeliveryDomain,
			accountConfigId: context.accountConfigId,
			accountId: context.accountId,
			messageId: context.messageId,
			partPath: part.partPath,
		}),
	}));
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
			authenticity: message.authenticity,
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

		const flags = description.messageFlag.map((f) => f.flagName);

		const client = getClient();

		// `accountId` is needed to build per-part `contentUrl` values for the
		// BodyPartResponse list and on the IMAP-backfill path. Resolve it from
		// the bodyStorageKey when the body has already been synced (free — the
		// URI encodes both ids), or fall back to a single Mailbox.get() lookup
		// to avoid a redundant query on the fast path.
		const idsFromKey = message.bodyStorageKey
			? extractAccountIdsFromBodyKey(message.bodyStorageKey)
			: null;
		let accountId = idsFromKey?.accountId;
		let mailboxFullPath: string | undefined;
		if (!accountId) {
			const mailbox = await client.mailbox.get(message.mailboxId);
			accountId = mailbox.accountId;
			mailboxFullPath = mailbox.fullPath;
		}

		// Trigger an IMAP backfill when the body has never been stored. The
		// fetcher writes the raw .eml + parsed.json.gz cache + per-part rows
		// as a side-effect; the SPA then renders body content via each
		// BodyPartResponse.contentUrl (CloudFront-fronted, JWT-authorized at
		// the edge). The handler no longer returns body text/html — that
		// payload moved to per-part fetches once content delivery cut over
		// (#224 PR 3/3). When bodyStorageKey is already set we skip IMAP
		// entirely; the worker has already populated parts.
		let bodyPartRows = description.bodyPart;
		if (!message.bodyStorageKey) {
			if (!mailboxFullPath) {
				const mailbox = await client.mailbox.get(message.mailboxId);
				mailboxFullPath = mailbox.fullPath;
			}
			const scope = await client.createConnectionScope(accountId);

			await client.bodySync
				.fetchAndGetBody(
					messageId,
					accountId,
					accountConfigId,
					mailboxFullPath,
					scope.getConnection,
				)
				.finally(() => scope.disconnect());

			// Body just landed via IMAP — re-read so the response includes the
			// parts the worker just wrote. Without this the first describe of a
			// never-synced message would return an empty bodyParts array.
			const refreshed = await client.message.describe(messageId);
			bodyPartRows = refreshed.bodyPart;
		}

		const bodyParts = buildBodyPartResponses(bodyPartRows, {
			contentDeliveryDomain: getContentDeliveryDomain(),
			accountConfigId,
			accountId,
			messageId,
		});

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
		};
	},

	MessageOperations_getRawMessage: async (
		context: Context,
		...args: unknown[]
	) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { messageId } = context.request.params as { messageId: string };
		const client = getClient();

		// Resolve the message row. `message.get` throws NotFoundError (→ 404)
		// when the id is unknown, matching describeMessage's not-found behavior.
		const message = await client.message.get(messageId);

		// Resolve accountId. When the body is already stored the bodyStorageKey
		// encodes both ids for free; otherwise fall back to a Mailbox lookup —
		// same resolution describeMessage uses.
		const idsFromKey = message.bodyStorageKey
			? extractAccountIdsFromBodyKey(message.bodyStorageKey)
			: null;
		let accountId = idsFromKey?.accountId;
		let mailboxFullPath: string | undefined;
		if (!accountId) {
			const mailbox = await client.mailbox.get(message.mailboxId);
			accountId = mailbox.accountId;
			mailboxFullPath = mailbox.fullPath;
		}

		// Cross-tenant ownership guard. Returning raw RFC822 bytes is sensitive,
		// so run the same unit-tested check mailbox/account handlers use BEFORE
		// any backfill or storage read — covering both the stored-body fast path
		// and the IMAP-backfill path with one consistent rule. `read` mode throws
		// NotFoundError (→ 404) on mismatch and never leaks the owner's
		// accountConfigId.
		const account = await client.account.get(accountId);
		assertAccountOwnership(account, accountConfigId, "read");

		// Backfill from IMAP when the body has never been stored, reusing the
		// exact path describeMessage uses. fetchAndGetBody writes the raw .eml +
		// parsed cache + per-part rows and sets message.bodyStorageKey as a
		// side-effect; we then re-read the row to pick up the freshly written key.
		if (!message.bodyStorageKey) {
			if (!mailboxFullPath) {
				const mailbox = await client.mailbox.get(message.mailboxId);
				mailboxFullPath = mailbox.fullPath;
			}
			const scope = await client.createConnectionScope(accountId);
			await client.bodySync
				.fetchAndGetBody(
					messageId,
					accountId,
					accountConfigId,
					mailboxFullPath,
					scope.getConnection,
				)
				.finally(() => scope.disconnect());
		}

		// Re-read so we have the bodyStorageKey the backfill just wrote (or the
		// key that was already present), then pull the raw bytes from storage.
		const stored = await client.message.get(messageId);
		if (!stored.bodyStorageKey) {
			throw new Error(
				`Raw source unavailable for message ${messageId}: no bodyStorageKey after backfill`,
			);
		}

		const body = await client.storage.retrieve(stored.bodyStorageKey);

		return { raw: decodeRawEml(body) };
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
