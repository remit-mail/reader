import type {
	BodyPartResponse,
	EnvelopeAddressResponse,
	EnvelopeResponse,
} from "@remit/api-openapi-types";
import type { MailboxItem } from "@remit/data-ports";
import {
	ForbiddenError,
	MessagePlacementUnsettledError,
	UnrecoverableBodyError,
} from "@remit/data-ports/errors";
import { isEncapsulatedMessage } from "@remit/data-ports/message-parts";
import {
	ContentDisposition,
	MediaType,
	MessageCategory,
	SenderTrust,
	type StarColor,
} from "@remit/domain-enums";
import { logger } from "@remit/logger";
import {
	guardConnectionCursor,
	isCursorRebuildNeeded,
	isMessageBodySyncBroken,
	MailboxCursorPausedError,
	MoveNotSettledError,
	materializeBodyParts,
	NoJunkMailboxError,
	ownedMessages,
	resolveFolderPlacement,
	settledFolder,
} from "@remit/mailbox-service";
import {
	isStorageNotFoundError as isStorageNotFoundErrorFromService,
	parseStorageUri,
} from "@remit/storage-service";
import type { Context } from "openapi-backend";
import { deriveAutoMoved } from "../derive/autoMoved.js";
import {
	type ContentSigner,
	getContentSigner,
} from "../derive/contentSignature.js";
import {
	buildContentUrl,
	getContentDeliveryDomain,
} from "../derive/contentUrl.js";
import { deriveSenderTrust } from "../derive/senderTrust.js";
import { unwrap } from "../service/refusal.js";
import type {
	HandlerContext,
	MessageBulkOperationIds,
	MessageOperationIds,
	OperationHandler,
} from "../types.js";

type MessageContext = HandlerContext<"sync" | "messageManagement" | "body">;

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

export const FORWARDED_MESSAGE_FILENAME = "Forwarded message.eml";

const responseFilename = (part: BodyPartLike): string | undefined => {
	if (part.dispositionFilename !== undefined) return part.dispositionFilename;
	return isEncapsulatedMessage(part) ? FORWARDED_MESSAGE_FILENAME : undefined;
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
		partPath: part.partPath,
		mediaType: assertMediaType(part.mediaType, part.bodyPartId),
		mediaSubtype: part.mediaSubtype,
		sizeOctets: part.sizeOctets,
		disposition: assertDisposition(part.disposition, part.bodyPartId),
		dispositionFilename: responseFilename(part),
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

export interface SpamReportBulkFailure {
	messageId: string;
	reason: string;
}

export interface SpamReportBulkOutcome {
	successCount: number;
	failureCount: number;
	failures?: SpamReportBulkFailure[];
}

/**
 * The fallback for a failure nobody designed copy for — an AWS SDK message
 * naming a queue URL, an `ECONNREFUSED host:port`, a programmer error.
 * Everything reaching it is flattened, same policy as `error.ts`'s "Internal
 * server error" flattening, because `SpamReportBulkResult.reason` is shown to
 * the user as-is. It says "try again" because retrying is the only thing left
 * to say about a cause we cannot name; an outcome the service DOES understand
 * carries its own text through `DESIGNED_FAILURES` instead of landing here.
 */
export const GENERIC_FAILURE_REASON =
	"This message could not be processed. Please try again. If it keeps failing, report it.";

/**
 * The designed, user-facing outcomes whose own message is returned verbatim:
 * each names what happened and what the user can do about it, which the
 * generic text cannot.
 */
const DESIGNED_FAILURES = [
	MoveNotSettledError,
	NoJunkMailboxError,
	MessagePlacementUnsettledError,
];

const isDesignedFailure = (reason: unknown): reason is Error =>
	DESIGNED_FAILURES.some((designed) => reason instanceof designed);

/**
 * The placement refusal is the one designed outcome whose own message is not
 * the text to ship: it names a uuid and no remedy. One remedy answers it, and
 * only one refusal reaches it — a mutation still in flight, which settles on
 * its own (imap-mutations R3). Worded here, the way the delete path words the
 * same refusal for the client.
 */
const placementRefusalReason = (
	_error: MessagePlacementUnsettledError,
): string =>
	"This message is still being moved on the mail server. Try again in a moment.";

const failureReason = (reason: unknown): string => {
	if (!isDesignedFailure(reason)) return GENERIC_FAILURE_REASON;
	if (reason instanceof MessagePlacementUnsettledError)
		return placementRefusalReason(reason);
	return reason.message;
};

/**
 * Drive one report-spam/not-spam operation per message, concurrently. Each
 * message's own wait for its move to settle (SpamReportService's R2 wait) is
 * bounded on its own, but running the batch sequentially would let those
 * waits accumulate across the whole request — 50 messages could each wait
 * seconds, serializing into minutes and dying at the proxy. Running them
 * concurrently instead bounds the whole request by a single message's wait,
 * regardless of batch size.
 */
export const settleSpamReportBulk = async (
	messageIds: string[],
	run: (messageId: string) => Promise<void>,
): Promise<SpamReportBulkOutcome> => {
	const results = await Promise.allSettled(
		messageIds.map((messageId) => run(messageId)),
	);

	let successCount = 0;
	const failures: SpamReportBulkFailure[] = [];
	results.forEach((result, index) => {
		if (result.status === "fulfilled") {
			successCount += 1;
			return;
		}
		const messageId = messageIds[index];
		failures.push({ messageId, reason: failureReason(result.reason) });
		logger.error(
			{ messageId, error: result.reason },
			"spam-report bulk operation failed for one message",
		);
	});

	return {
		successCount,
		failureCount: failures.length,
		...(failures.length > 0 ? { failures } : {}),
	};
};

export const MessageOperations: Record<
	MessageOperationIds,
	OperationHandler<MessageOperationIds, "sync" | "messageManagement" | "body">
> = {
	MessageOperations_describeMessage: async (
		context: Context,
		ctx: MessageContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { messageId } = context.request.params as { messageId: string };
		const client = ctx.client;
		const ownedAccountId = unwrap(
			await ownedMessages(client, [messageId], accountConfigId, "read"),
		);
		const description = await client.message.describe(messageId);

		const message = description.message[0];
		const envelope = description.envelope[0];
		const threadMessage = await client.threadMessage.findByMessageId(
			accountConfigId,
			messageId,
		);

		const autoMoved = deriveAutoMoved(message);

		// Labels applied to this message (issue #26) — filter-, organize-, and
		// manually-applied alike. A message rarely carries more than a handful, so
		// a `get` per label id (not a batch fetch) is the whole cost.
		const messageLabelRows = await client.messageLabel.listByMessageId(
			message.messageId,
		);
		const labels = await Promise.all(
			messageLabelRows.map(async (row) => {
				const label = await client.label.get(accountConfigId, row.labelId);
				return { labelId: label.labelId, name: label.name, color: label.color };
			}),
		);

		// Not typed against the generated `MessageSummaryResponse`: `labels` is a
		// new field on it in this same PR, and that package publishes separately
		// from this repo — a local-codegen-only field would fail
		// `check-consumer-typecheck`/`release:dry-run`, which resolve generated
		// `@remit/*` packages off the registry, not the local `build/` output.
		const messageSummary = {
			messageId: message.messageId,
			mailboxId: message.mailboxId,
			uid: message.uid,
			rfc822Size: message.rfc822Size,
			internalDate: message.internalDate,
			messageIdHeader: threadMessage?.messageIdHeader,
			authenticity: message.authenticity,
			status: message.status,
			syncStatus: message.syncStatus,
			abandonedMutation: message.abandonedMutation,
			...(autoMoved ? { autoMoved } : {}),
			...(labels.length > 0 ? { labels } : {}),
			...(message.spamReport ? { spamReport: message.spamReport } : {}),
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
		let mailbox: MailboxItem | undefined;
		if (!accountId) {
			mailbox = await client.mailbox.get(ownedAccountId, message.mailboxId);
			accountId = mailbox.accountId;
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
			// A message whose body-sync exhausted every retry against real
			// (broken) content never gets a bodyStorageKey (issue #1270 / epic
			// #1281 invariant 3) — this branch is the ONLY place that condition
			// can occur, so the sentinel check lives here instead of unconditionally
			// at the top of the handler, which would tax every already-synced
			// read with an S3 HEAD it can never need. Checking before the backfill
			// attempt stops a client from looping through repeated 202s
			// (materializeBodyParts) or repeated synchronous IMAP round-trips
			// (fetchAndGetBody) on a message that can never succeed.
			if (
				await isMessageBodySyncBroken(
					client.storage,
					accountConfigId,
					accountId,
					messageId,
				)
			) {
				throw new UnrecoverableBodyError(
					"This message's content could not be retrieved. Please report this issue.",
				);
			}

			if (!mailbox) {
				mailbox = await client.mailbox.get(accountId, message.mailboxId);
			}

			// Cheap frugal skip (epic #1281 invariant 6): a mailbox already known
			// paused never even opens a connection. Optimization only —
			// guardConnectionCursor's openBox wrap below is the structural
			// guarantee (issue #1272's read-path detection point).
			if (isCursorRebuildNeeded(mailbox.cursorState)) {
				logger.debug(
					{
						accountId,
						mailboxId: mailbox.mailboxId,
						messageId,
						cursorState: mailbox.cursorState,
					},
					"Mailbox cursor not normal; skipping IMAP body backfill for this request",
				);
			} else {
				const folder = {
					mailboxId: mailbox.mailboxId,
					fullPath: mailbox.fullPath,
					placement: await resolveFolderPlacement(
						client.mailboxSpecialUse,
						accountId,
						mailbox.mailboxId,
					),
				};
				const scope = await client.createConnectionScope(accountId);
				// Guard at the one choke point every UID-based IMAP op already
				// passes through: openBox. A mismatch trips the mailbox to
				// cursor_invalid and throws; caught below as a routine skip (epic
				// #1281 invariant 3) — the request just returns without a fresh
				// backfill this time.
				const connection = guardConnectionCursor(
					await scope.getConnection(),
					{ mailboxService: client.mailbox },
					accountId,
					mailbox,
				);

				await client.bodySync
					.fetchAndGetBody(messageId, accountId, accountConfigId, folder, () =>
						Promise.resolve(connection),
					)
					.catch((error: unknown) => {
						if (error instanceof MailboxCursorPausedError) {
							logger.debug(
								{
									accountId,
									mailboxId: mailbox?.mailboxId,
									messageId,
									cursorState: error.state,
								},
								"Mailbox cursor not normal; skipping IMAP body backfill for this request",
							);
							return;
						}
						throw error;
					})
					.finally(() => scope.disconnect());

				// Body just landed via IMAP — re-read so the response includes the
				// parts the worker just wrote. Without this the first describe of a
				// never-synced message would return an empty bodyParts array.
				const refreshed = await client.message.describe(messageId);
				bodyPartRows = refreshed.bodyPart;
				bodyStorageKey = refreshed.message[0]?.bodyStorageKey;
			}
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
		ctx: MessageContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { messageId } = context.request.params as { messageId: string };
		const client = ctx.client;

		// Cross-tenant ownership guard. Returning raw RFC822 bytes is sensitive,
		// so resolve the owning account and prove the caller owns it BEFORE any
		// storage read or backfill. `read` mode throws NotFoundError (→ 404) on a
		// foreign message and never leaks the owner's accountConfigId.
		const accountId = unwrap(
			await ownedMessages(client, [messageId], accountConfigId, "read"),
		);

		// Resolve the message row for its mailboxId / bodyStorageKey.
		const message = await client.message.get(messageId);

		// Backfill from IMAP when the body has never been stored, reusing the
		// exact path describeMessage uses. fetchAndGetBody writes the raw .eml +
		// parsed cache + per-part rows and sets message.bodyStorageKey as a
		// side-effect; we then re-read the row to pick up the freshly written key.
		if (!message.bodyStorageKey) {
			const mailbox = await client.mailbox.get(accountId, message.mailboxId);

			// Cheap frugal skip (epic #1281 invariant 6): a mailbox already known
			// paused never even opens a connection. The existing "no
			// bodyStorageKey after backfill" check just past this block is
			// already the right signal for that case, so no new response shape
			// is needed here.
			if (isCursorRebuildNeeded(mailbox.cursorState)) {
				logger.debug(
					{
						accountId,
						mailboxId: mailbox.mailboxId,
						messageId,
						cursorState: mailbox.cursorState,
					},
					"Mailbox cursor not normal; skipping IMAP body backfill for this request",
				);
			} else {
				const folder = {
					mailboxId: mailbox.mailboxId,
					fullPath: mailbox.fullPath,
					placement: await resolveFolderPlacement(
						client.mailboxSpecialUse,
						accountId,
						mailbox.mailboxId,
					),
				};
				const scope = await client.createConnectionScope(accountId);
				// Guard at the openBox choke point — a fresh mismatch trips the
				// mailbox and throws once the SELECT reveals it; caught below.
				const connection = guardConnectionCursor(
					await scope.getConnection(),
					{ mailboxService: client.mailbox },
					accountId,
					mailbox,
				);
				await client.bodySync
					.fetchAndGetBody(messageId, accountId, accountConfigId, folder, () =>
						Promise.resolve(connection),
					)
					.catch((error: unknown) => {
						if (error instanceof MailboxCursorPausedError) {
							logger.debug(
								{
									accountId,
									mailboxId: mailbox.mailboxId,
									messageId,
									cursorState: error.state,
								},
								"Mailbox cursor not normal; skipping IMAP body backfill for this request",
							);
							return;
						}
						throw error;
					})
					.finally(() => scope.disconnect());
			}
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

	MessageOperations_updateMessageFlags: async (
		context,
		ctx: MessageContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { messageId } = context.request.params as { messageId: string };
		const { isRead, isStarred, starColor } = context.request.requestBody as {
			isRead?: boolean;
			isStarred?: boolean;
			starColor?: string;
		};

		const client = ctx.client;
		const accountId = unwrap(
			await ownedMessages(client, [messageId], accountConfigId, "act"),
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
	OperationHandler<
		MessageBulkOperationIds,
		"sync" | "messageManagement" | "body"
	>
> = {
	MessageBulkOperations_updateFlags: async (context, ctx: MessageContext) => {
		const accountConfigId = ctx.identity.accountConfigId;
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

		const client = ctx.client;
		const accountId = unwrap(
			await ownedMessages(client, messageIds, accountConfigId, "act"),
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

	MessageBulkOperations_deleteMessages: async (
		context,
		ctx: MessageContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { messageIds, permanent } = context.request.requestBody as {
			messageIds: string[];
			permanent?: boolean;
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = ctx.client;
		const accountId = unwrap(
			await ownedMessages(client, messageIds, accountConfigId, "act"),
		);

		// MessageMoveService handles: Message + ThreadMessage updates + SQS events
		const { refusedMessageIds } = await client.messageMove.deleteMessages(
			accountConfigId,
			messageIds,
			accountId,
			{
				permanent,
			},
		);

		// A row whose placement changed under the batch is reported, not dropped.
		// The response already carries per-row counts, which is the honest shape
		// for a batch that partly applied — a 409 over it would deny the deletes
		// that did happen, and silence leaves the client's optimistic removal to
		// reappear with nothing said (imap-mutations R3).
		return {
			successCount: messageIds.length - refusedMessageIds.length,
			failureCount: refusedMessageIds.length,
		};
	},

	MessageBulkOperations_moveMessages: async (context, ctx: MessageContext) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { messageIds, destinationMailboxId } = context.request
			.requestBody as {
			messageIds: string[];
			destinationMailboxId: string;
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = ctx.client;
		const accountId = unwrap(
			await ownedMessages(client, messageIds, accountConfigId, "act"),
		);

		// Destination must belong to the same (caller-owned) account, and must be
		// a folder the mail server has settled: the row records the destination
		// before the move confirms, so binding to a folder that may never exist
		// leaves the message pointing at nothing (D12, first row).
		const destination = await client.mailbox.get(
			accountId,
			destinationMailboxId,
		);
		if (destination.accountId !== accountId) {
			throw new ForbiddenError(
				`Destination mailbox ${destinationMailboxId} not in account`,
			);
		}
		unwrap(settledFolder(destination));

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

	MessageBulkOperations_copyMessages: async (context, ctx: MessageContext) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { messageIds, destinationMailboxId } = context.request
			.requestBody as {
			messageIds: string[];
			destinationMailboxId: string;
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = ctx.client;
		const accountId = unwrap(
			await ownedMessages(client, messageIds, accountConfigId, "act"),
		);

		// Destination must belong to the same (caller-owned) account, and must be
		// a folder the mail server has settled: the row records the destination
		// before the move confirms, so binding to a folder that may never exist
		// leaves the message pointing at nothing (D12, first row).
		const destination = await client.mailbox.get(
			accountId,
			destinationMailboxId,
		);
		if (destination.accountId !== accountId) {
			throw new ForbiddenError(
				`Destination mailbox ${destinationMailboxId} not in account`,
			);
		}
		unwrap(settledFolder(destination));

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

	MessageBulkOperations_updateMessageLabels: async (
		context,
		ctx: MessageContext,
	) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { messageIds, labelId, action } = context.request.requestBody as {
			messageIds: string[];
			labelId: string;
			action: "Apply" | "Remove";
		};

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = ctx.client;
		unwrap(await ownedMessages(client, messageIds, accountConfigId, "act"));

		// Scoped by accountConfigId (RFC 030) — a foreign labelId 404s here rather
		// than silently applying to messages under someone else's label.
		await client.label.get(accountConfigId, labelId);

		// `appliedByFilterId` stays absent — this is the manual "just these" scope
		// (RFC 034 Decision 3.3), never filter-attributed.
		if (action === "Apply") {
			for (const messageId of messageIds) {
				await client.messageLabel.apply({
					accountConfigId,
					messageId,
					labelId,
				});
			}
		} else {
			for (const messageId of messageIds) {
				await client.messageLabel.remove(messageId, labelId);
			}
		}

		return {
			successCount: messageIds.length,
			failureCount: 0,
		};
	},

	MessageBulkOperations_reportSpam: async (context, ctx: MessageContext) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { messageIds: requestedIds } = context.request.requestBody as {
			messageIds: string[];
		};
		const messageIds = [...new Set(requestedIds)];

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = ctx.client;
		const accountId = unwrap(
			await ownedMessages(client, messageIds, accountConfigId, "act"),
		);
		const setBy = ctx.identity.sub;

		return settleSpamReportBulk(messageIds, (messageId) =>
			client.spamReport.reportSpam({
				accountConfigId,
				accountId,
				messageId,
				setBy,
			}),
		);
	},

	MessageBulkOperations_notSpam: async (context, ctx: MessageContext) => {
		const accountConfigId = ctx.identity.accountConfigId;
		const { messageIds: requestedIds } = context.request.requestBody as {
			messageIds: string[];
		};
		const messageIds = [...new Set(requestedIds)];

		if (messageIds.length === 0) {
			return { successCount: 0, failureCount: 0 };
		}

		const client = ctx.client;
		const accountId = unwrap(
			await ownedMessages(client, messageIds, accountConfigId, "act"),
		);

		return settleSpamReportBulk(messageIds, (messageId) =>
			client.spamReport.notSpam({ accountConfigId, accountId, messageId }),
		);
	},
};
