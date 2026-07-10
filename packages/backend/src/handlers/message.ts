import {
	BadRequestError,
	ForbiddenError,
	NotFoundError,
} from "@remit/remit-electrodb-service";
import {
	ContentDisposition,
	MediaType,
	MessageCategory,
	SenderTrust,
	type StarColor,
} from "@remit/domain-enums";
import { logger } from "@remit/logger-lambda";
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
	type ContentSigner,
	getContentSigner,
} from "../derive/contentSignature.js";
import {
	buildContentUrl,
	getContentDeliveryDomain,
} from "../derive/contentUrl.js";
import { deriveSenderTrust } from "../derive/senderTrust.js";
import { getClient } from "../service/dynamodb.js";
import type {
	MessageBulkOperationIds,
	MessageOperationIds,
	OperationHandler,
} from "../types.js";

type StarColorValue = (typeof StarColor)[keyof typeof StarColor];

interface MessageOwnershipClient {
	message: { get(messageId: string): Promise<{ mailboxId: string }> };
	mailbox: {
		get(
			accountId: string,
			mailboxIds: string[],
		): Promise<{ mailboxId: string; accountId: string }[]>;
	};
	account: {
		listAllByAccountConfig(
			accountConfigId: string,
		): Promise<{ accountId: string }[]>;
	};
}

/**
 * Resolve the account that owns every message in `messageIds` and assert the
 * caller owns it. Messages have no tenant column, so ownership resolves through
 * the mailbox: the caller's own accounts (from their accountConfigId) scope a
 * mailbox lookup, and a mailbox resolves only under the account that owns it —
 * a foreign message never resolves and throws before any content is returned or
 * mutated (`read` -> 404, no existence leak; `act` -> 403). The tenant comes
 * from the caller's config, never from the row being read. The whole batch must
 * resolve to a single account — the downstream flag/move/delete services take
 * one accountId — so a batch spanning accounts is rejected. Returns that
 * accountId so callers reuse it without another lookup.
 */
export const assertMessagesOwned = async (
	client: MessageOwnershipClient,
	messageIds: string[],
	callerAccountConfigId: string,
	mode: "read" | "act",
): Promise<string> => {
	const messages = await Promise.all(
		messageIds.map((id) => client.message.get(id)),
	);
	const mailboxIds = [...new Set(messages.map((m) => m.mailboxId))];

	const ownedAccounts = await client.account.listAllByAccountConfig(
		callerAccountConfigId,
	);

	const accountByMailbox = new Map<string, string>();
	for (const { accountId } of ownedAccounts) {
		const rows = await client.mailbox.get(accountId, mailboxIds);
		for (const row of rows) {
			accountByMailbox.set(row.mailboxId, row.accountId);
		}
	}

	if (mailboxIds.some((id) => !accountByMailbox.has(id))) {
		if (mode === "read") {
			throw new NotFoundError("Message not found");
		}
		throw new ForbiddenError("Message not in account config");
	}

	const accountIds = [...new Set(accountByMailbox.values())];
	if (accountIds.length !== 1) {
		throw new BadRequestError("All messages must belong to the same account");
	}

	return accountIds[0];
};

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
		sign?: ContentSigner;
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
			sign: context.sign,
		}),
	}));
};

/**
 * The slice of `BodySyncService` the read path needs to lazily materialize
 * deferred per-part objects. Narrowed to one method so the orchestration below
 * can be unit-tested without standing up the whole client.
 */
export interface BodyPartMaterializer {
	ensureBodyPartsStored(
		accountConfigId: string,
		accountId: string,
		messageId: string,
		bodyStorageKey: string,
	): Promise<unknown>;
}

export interface MaterializeLogger {
	warn(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Re-arms the body-sync cue for one message (the read-path slice of
 * `BodySyncQueueService`). Narrowed to one method so the orchestration below can
 * be unit-tested without an SQS client.
 */
export interface BodySyncCue {
	requestBodySync(input: {
		accountId: string;
		mailboxId: string;
		messageId: string;
		uid?: number;
	}): Promise<void>;
}

export interface MaterializeResult {
	/** `false` when the body object was missing — the caller must not 200 the body. */
	ready: boolean;
}

/**
 * Materialize the deferred per-part storage objects for a message before the
 * SPA fetches any `contentUrl`. Distinguishes the two failure modes the body
 * contract cares about:
 *
 * - Missing storage object (never synced or lost) — re-arm the SYNC_MESSAGE_BODY
 *   cue so the worker (re)stores the body, and report `ready: false`. Not a
 *   500: a retry succeeds once the worker catches up.
 * - Any other error — rethrow so the request 500s and the bug is observable.
 *   Never swallowed, never "best-effort".
 *
 * No-op (`ready: true`) when the body isn't stored yet (no `bodyStorageKey`) or
 * when the parts were written eagerly.
 */
export const materializeBodyParts = async (
	materializer: BodyPartMaterializer,
	args: {
		accountConfigId: string;
		accountId: string;
		mailboxId: string;
		messageId: string;
		uid?: number;
		bodyStorageKey: string | undefined;
		cue: BodySyncCue | undefined;
		logger: MaterializeLogger;
	},
): Promise<MaterializeResult> => {
	const { accountConfigId, accountId, mailboxId, messageId, uid } = args;
	if (!args.bodyStorageKey) return { ready: true };

	try {
		await materializer.ensureBodyPartsStored(
			accountConfigId,
			accountId,
			messageId,
			args.bodyStorageKey,
		);
		return { ready: true };
	} catch (error: unknown) {
		if (!isStorageNotFoundError(error)) throw error;

		args.logger.warn(
			{ messageId, accountId, mailboxId },
			"Body object missing on read; re-arming body-sync cue and signalling retry",
		);
		await args.cue?.requestBodySync({ accountId, mailboxId, messageId, uid });
		return { ready: false };
	}
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
		const client = getClient();
		const ownedAccountId = await assertMessagesOwned(
			client,
			[messageId],
			accountConfigId,
			"read",
		);
		const description = await client.message.describe(messageId);

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
			? await client.address.getAddress(accountConfigId, uniqueAddressIds)
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
			category: message.category ?? MessageCategory.uncategorized,
			senderTrust,
		};

		const flags = description.messageFlag.map((f) => f.flagName);

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
			const mailbox = await client.mailbox.get(
				ownedAccountId,
				message.mailboxId,
			);
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
		let bodyStorageKey = message.bodyStorageKey;
		if (!bodyStorageKey) {
			if (!mailboxFullPath) {
				const mailbox = await client.mailbox.get(accountId, message.mailboxId);
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
			bodyStorageKey = refreshed.message[0]?.bodyStorageKey;
		}

		// Per-part storage objects are deferred during bulk sync (DEFER_BODY_PARTS)
		// to cut write amplification. Content delivery serves each part straight
		// from storage with no Lambda in the request path, so a deferred (missing)
		// object would surface to the SPA as a hard failure. Materialize them here —
		// idempotent, skips parts already stored — so every contentUrl below
		// resolves on first open. No-op when parts were written eagerly.
		//
		// A missing body object re-arms the SYNC_MESSAGE_BODY cue (so the worker
		// (re)stores it) and leaves the contentUrls to surface a retryable 202 on
		// the content route; any other error is rethrown and 500s loudly.
		await materializeBodyParts(client.bodySync, {
			accountConfigId,
			accountId,
			mailboxId: message.mailboxId,
			messageId,
			uid: message.uid,
			bodyStorageKey,
			cue: client.bodySyncQueue,
			logger,
		});

		const bodyParts = buildBodyPartResponses(bodyPartRows, {
			contentDeliveryDomain: getContentDeliveryDomain(),
			accountConfigId,
			accountId,
			messageId,
			sign: getContentSigner(),
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

		// Cross-tenant ownership guard. Returning raw RFC822 bytes is sensitive,
		// so resolve the owning account and prove the caller owns it BEFORE any
		// storage read or backfill. `read` mode throws NotFoundError (→ 404) on a
		// foreign message and never leaks the owner's accountConfigId.
		const accountId = await assertMessagesOwned(
			client,
			[messageId],
			accountConfigId,
			"read",
		);

		// Resolve the message row for its mailboxId / bodyStorageKey.
		const message = await client.message.get(messageId);
		let mailboxFullPath: string | undefined;

		// Backfill from IMAP when the body has never been stored, reusing the
		// exact path describeMessage uses. fetchAndGetBody writes the raw .eml +
		// parsed cache + per-part rows and sets message.bodyStorageKey as a
		// side-effect; we then re-read the row to pick up the freshly written key.
		if (!message.bodyStorageKey) {
			if (!mailboxFullPath) {
				const mailbox = await client.mailbox.get(accountId, message.mailboxId);
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

	MessageOperations_updateMessageFlags: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { messageId } = context.request.params as { messageId: string };
		const { isRead, isStarred, starColor } = context.request.requestBody as {
			isRead?: boolean;
			isStarred?: boolean;
			starColor?: string;
		};

		const client = getClient();
		const accountId = await assertMessagesOwned(
			client,
			[messageId],
			accountConfigId,
			"act",
		);

		// FlagQueueService handles: MessageFlag + ThreadMessage updates + SQS event
		const result = await client.flagQueue.updateFlags(
			accountConfigId,
			messageId,
			accountId,
			{
				isRead,
				isStarred,
				starColor: starColor as StarColorValue | undefined,
			},
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
	MessageBulkOperations_updateFlags: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
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
		const accountId = await assertMessagesOwned(
			client,
			messageIds,
			accountConfigId,
			"act",
		);

		// FlagQueueService handles: MessageFlag + ThreadMessage updates + SQS events
		// Process each message individually (same pattern as moveMessages)
		for (const messageId of messageIds) {
			await client.flagQueue.updateFlags(
				accountConfigId,
				messageId,
				accountId,
				{
					isRead,
					isStarred,
					starColor: starColor as StarColorValue | undefined,
				},
			);
		}

		return {
			successCount: messageIds.length,
			failureCount: 0,
		};
	},

	MessageBulkOperations_deleteMessages: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { messageIds, permanent } = context.request.requestBody as {
			messageIds: string[];
			permanent?: boolean;
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = getClient();
		const accountId = await assertMessagesOwned(
			client,
			messageIds,
			accountConfigId,
			"act",
		);

		// MessageMoveService handles: Message + ThreadMessage updates + SQS events
		await client.messageMove.deleteMessages(
			accountConfigId,
			messageIds,
			accountId,
			{
				permanent,
			},
		);

		return {
			successCount: messageIds.length,
			failureCount: 0,
		};
	},

	MessageBulkOperations_moveMessages: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { messageIds, destinationMailboxId } = context.request
			.requestBody as {
			messageIds: string[];
			destinationMailboxId: string;
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = getClient();
		const accountId = await assertMessagesOwned(
			client,
			messageIds,
			accountConfigId,
			"act",
		);

		// Destination must belong to the same (caller-owned) account.
		const destination = await client.mailbox.get(
			accountId,
			destinationMailboxId,
		);
		if (destination.accountId !== accountId) {
			throw new ForbiddenError(
				`Destination mailbox ${destinationMailboxId} not in account`,
			);
		}

		// MessageMoveService handles: Message + ThreadMessage updates + SQS events
		await client.messageMove.moveMessages(
			accountConfigId,
			messageIds,
			destinationMailboxId,
			accountId,
		);

		return {
			successCount: messageIds.length,
			failureCount: 0,
		};
	},

	MessageBulkOperations_copyMessages: async (context, ...args: unknown[]) => {
		const event = args[0] as APIGatewayProxyEvent;
		const accountConfigId = getAccountConfigIdFromEvent(event);
		const { messageIds, destinationMailboxId } = context.request
			.requestBody as {
			messageIds: string[];
			destinationMailboxId: string;
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = getClient();
		const accountId = await assertMessagesOwned(
			client,
			messageIds,
			accountConfigId,
			"act",
		);

		// Destination must belong to the same (caller-owned) account.
		const destination = await client.mailbox.get(
			accountId,
			destinationMailboxId,
		);
		if (destination.accountId !== accountId) {
			throw new ForbiddenError(
				`Destination mailbox ${destinationMailboxId} not in account`,
			);
		}

		// MessageMoveService handles: Message copies + ThreadMessage creation + SQS events
		await client.messageMove.copyMessages(
			accountConfigId,
			messageIds,
			destinationMailboxId,
			accountId,
		);

		return {
			successCount: messageIds.length,
			failureCount: 0,
		};
	},
};
