import type { OutboxMessageItem, QueueProducer } from "@remit/data-ports";
import { deriveAddressId, deriveMessageId } from "@remit/data-ports/id";
import {
	AccountAuthType,
	type ConnectionState,
	OutboxMessageStatus,
} from "@remit/domain-enums";
import { createLogger, type MailFailureKind } from "@remit/logger";
import {
	type MailOAuthService,
	RefreshTokenError,
} from "@remit/mail-oauth-service";
// Subpath import, not the package root: the root barrel re-exports the whole
// IMAP sync surface (mailbox/flag/message sync, snippet/heuristics text
// processing), which drags `natural` and friends into a bundle that only
// ever calls resolveConnectionCredentials.
import {
	type AccountCredentialsDeps,
	resolveConnectionCredentials,
} from "@remit/mailbox-service/account-credentials";
import {
	loadOutboxAttachmentContents,
	OutboxAttachmentUnavailableError,
} from "@remit/mailbox-service/outbox-attachment-content";
import type { SecretsService } from "@remit/secrets-service";
import {
	buildMailMessage,
	type SendResult,
	SmtpConnectionError,
	type SmtpGetSocket,
	sendMail,
} from "@remit/smtp-service";
import type { AppendSentMessageEvent, SendMessageEvent } from "../events.js";
import type { SmtpDataPorts } from "../ports.js";
import type { AttachmentReader } from "./attachment-storage.js";
import {
	type EngagementCounterDeps,
	writeEngagementCounters,
} from "./engagement-counters.js";
import {
	resolveSmtpConfig,
	type SmtpCredentials,
} from "./resolve-smtp-config.js";

export interface SendMessageContext {
	ports: SmtpDataPorts;
	secrets: SecretsService;
	storage: AttachmentReader;
	messageManagement: QueueProducer<AppendSentMessageEvent>;
	tokenService: Pick<MailOAuthService, "getAccessToken">;
	getSocket: SmtpGetSocket;
	maxAttempts: number;
	recordSmtpFailure: (kind: MailFailureKind) => void;
}

const log = createLogger();

const credentialDeps = (ctx: SendMessageContext): AccountCredentialsDeps => ({
	secrets: ctx.secrets,
	tokenService: ctx.tokenService,
	persistRotatedToken: async (accountId, encryptedHash, updatedAt) => {
		await ctx.ports.account.update(accountId, {
			oauthRefreshTokenHash: encryptedHash,
			oauthTokenUpdatedAt: updatedAt,
		});
	},
});

/**
 * Persist the account's connectionState, and with it the sentence the account
 * card shows. `lastError` carries the server's own words when the refusal
 * came with any; a flip with no reason of its own removes the stored one, so
 * the card never reads back a failure the account has moved on from.
 */
const updateConnectionState = async (
	ports: SmtpDataPorts,
	accountId: string,
	state: (typeof ConnectionState)[keyof typeof ConnectionState],
	lastError?: string,
): Promise<void> => {
	await ports.account.update(
		accountId,
		{ connectionState: state, lastError },
		lastError === undefined ? ["lastError"] : undefined,
	);
};

const isNotFound = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"name" in error &&
	error.name === "NotFoundError";

const engagementDeps = (ports: SmtpDataPorts): EngagementCounterDeps => ({
	resolveAddressId: deriveAddressId,
	incrementOutboundCount: (accountConfigId, addressId, now) =>
		ports.address.incrementOutboundCount(accountConfigId, addressId, now),
	incrementReplyCount: (accountConfigId, addressId, now) =>
		ports.address.incrementReplyCount(accountConfigId, addressId, now),
	findMessageByHeader: (accountId, messageIdHeader) =>
		ports.message
			.get(deriveMessageId(accountId, messageIdHeader))
			.catch((error: unknown) => {
				if (isNotFound(error)) return null;
				throw error;
			}),
	getEnvelopeFromEmail: async (messageId) => {
		const data = await ports.envelope
			.getMessageData(messageId)
			.catch((error: unknown) => {
				if (isNotFound(error)) return null;
				throw error;
			});
		if (!data) return null;
		const fromEntry = data.envelopeAddress.find(
			(addr) => addr.addressRole === "from",
		);
		return fromEntry?.normalizedEmail ?? null;
	},
});

const emitAppendSentMessage = (
	ctx: SendMessageContext,
	accountId: string,
	outboxMessageId: string,
): Promise<void> =>
	ctx.messageManagement.send({
		body: {
			type: "APPEND_SENT_MESSAGE",
			accountId,
			outboxMessageId,
			eventId: crypto.randomUUID(),
			timestamp: Date.now(),
		},
	});

const UNFILED_NOT_QUEUED =
	"Sent, but not filed: the copy for the Sent folder could not be queued.";

/**
 * Every re-auth branch settles the row with this, because the row is the only
 * place the user learns the send stopped: `blocked` shows its reason and offers
 * no Retry, and a retry cannot succeed until the account is reconnected.
 */
const REAUTH_REQUIRED =
	"This account needs to be reconnected before it can send. Open Settings → Accounts and choose Reconnect, then send this message again.";

const UNFILED_CONNECTION_LOST =
	"The connection to the outgoing server dropped during the send, so this message may already have been delivered. Check with the recipient before sending it again.";

/**
 * The connection failures that prove nothing was submitted: no session ever
 * opened, so the server holds no copy and `failed` is safe — Retry sends the
 * only copy there is.
 *
 * `ECONNRESET` and `ETIMEDOUT` classify as `network` too and are deliberately
 * absent. Either can land after DATA, with the message already queued on the
 * server, and a `failed` row invites a Retry that delivers it twice.
 */
const NEVER_SUBMITTED_CODES: ReadonlySet<string> = new Set([
	"ECONNREFUSED",
	"ENOTFOUND",
	"EHOSTUNREACH",
]);

const errorCode = (cause: unknown): string =>
	cause instanceof Error && "code" in cause && typeof cause.code === "string"
		? cause.code
		: "";

/**
 * Whether the message can be re-sent without risking a second copy. An auth
 * rejection is decided before the envelope; a connection failure carries the
 * code that says how far it got. Anything else counts as possibly delivered,
 * which is the answer that cannot produce a duplicate.
 */
const neverSubmitted = (err: SmtpConnectionError): boolean =>
	err.kind === "auth" || NEVER_SUBMITTED_CODES.has(errorCode(err.cause));

const SENDABLE_STATUSES: ReadonlySet<OutboxMessageItem["status"]> = new Set([
	OutboxMessageStatus.draft,
	OutboxMessageStatus.queued,
	OutboxMessageStatus.sending,
]);

/**
 * Why a message stopped at its files, in words the Outbox can show. A `failed`
 * row can be edited, sent again and discarded (#933), so the sentence names
 * the file and what to do about it.
 */
const attachmentFailureReason = (error: unknown): string =>
	error instanceof OutboxAttachmentUnavailableError
		? `${error.message}, so this message was not sent. Remove "${error.filename}", attach it again, and send.`
		: `The files on this message could not be read (${error instanceof Error ? error.message : String(error)}), so it was not sent. Send it again.`;

export const handleSendMessage = async (
	event: SendMessageEvent,
	ctx: SendMessageContext,
	receiveCount: number,
): Promise<void> => {
	const { outboxMessageId, accountId } = event;
	const { ports } = ctx;

	log.info({ outboxMessageId, accountId }, "Processing send message event");

	// Load the account first: its accountConfigId scopes every outbox lookup and
	// update. The worker's tenant comes from the account it loads by accountId,
	// never off the outbox row it fetches.
	const account = await ports.account.get(accountId);
	const { accountConfigId } = account;

	const outbox = await ports.outboxMessage.get(
		accountConfigId,
		outboxMessageId,
	);
	// The fence against SQS at-least-once redelivery, stated as the states a
	// send may proceed FROM. Every other state has already been on the wire, so
	// naming them one by one is how a state added later silently starts sending
	// twice.
	if (!SENDABLE_STATUSES.has(outbox.status)) {
		log.info(
			{ outboxMessageId, status: outbox.status },
			"Message already left the queue, skipping",
		);
		return;
	}

	// `send` queues a row before it emits, so an event that finds one at `draft`
	// found a row the user pulled back into the composer after the emit. That is
	// not a stalled send and it keeps its own state. Every other settle is
	// conditional on the status the send was decided against, so a row that has
	// moved on since is not overwritten either.
	const settleBlockedOnReauth = async (
		expected: OutboxMessageItem["status"] = outbox.status,
	): Promise<void> => {
		if (expected === OutboxMessageStatus.draft) return;
		await ports.outboxMessage.updateIfStatus(
			accountConfigId,
			outboxMessageId,
			expected,
			{
				status: OutboxMessageStatus.blocked,
				lastError: REAUTH_REQUIRED,
			},
		);
	};

	// Tombstone fence: drop events for deleted accounts (#228)
	if (account.deletedAt) {
		log.info(
			{ accountId, deletedAt: account.deletedAt },
			"Account deleted, dropping send event",
		);
		return;
	}

	// Reauth fence: skip accounts that need re-authentication. No SMTP traffic
	// until the user re-auths (mirrors the IMAP reauth/ACK contract, #472).
	if (account.connectionState === "reauth_required") {
		await settleBlockedOnReauth();
		log.info(
			{ accountId, connectionState: account.connectionState },
			"Account requires reauth, blocking the message",
		);
		return;
	}

	// Resolve credentials. On a terminal OAuth auth failure (token revoked),
	// flip the account to reauth_required and ACK — do not retry. Transient /
	// config failures rethrow for SQS retry/backoff.
	let credentials: SmtpCredentials | undefined;
	try {
		const resolution = await resolveConnectionCredentials(
			account,
			credentialDeps(ctx),
		);
		if (resolution.status === "missing") {
			// Terminal, never a retry (issue #1120). The account still sends if it
			// carries an SMTP-specific credential of its own, so this hands
			// resolveSmtpConfig no credential and lets it decide; where there is
			// none either, the send settles `blocked` below.
			log.warn(
				{
					accountId,
					reason: resolution.reason,
					connectionState: resolution.terminalState,
				},
				"Account stores no credential",
			);
			await updateConnectionState(ports, accountId, resolution.terminalState);
		} else {
			credentials = resolution.credentials;
		}
	} catch (err) {
		if (err instanceof RefreshTokenError) {
			if (err.error.kind === "reauth-required") {
				log.warn(
					{ accountId, errorKind: err.error.kind, errorCode: err.error.code },
					"OAuth token revoked; marking account reauth_required",
				);
				await updateConnectionState(ports, accountId, "reauth_required");
				await settleBlockedOnReauth();
				return; // ACK — do not retry
			}
			// transient or config: let-it-crash (SQS retry / DLQ)
			throw err;
		}
		if (err instanceof SmtpConnectionError && err.kind === "auth") {
			// Only OAuth accounts have a re-auth recovery path. For password
			// accounts, rethrow to preserve pre-PR batch-item-failure behaviour.
			if (account.authType !== AccountAuthType.OauthMicrosoft) {
				throw err;
			}
			log.warn(
				{ accountId, errorKind: err.kind, error: err.message },
				"SMTP auth rejected; marking account reauth_required",
			);
			await updateConnectionState(
				ports,
				accountId,
				"reauth_required",
				err.message,
			);
			await settleBlockedOnReauth();
			return; // ACK — do not retry
		}
		throw err;
	}
	const resolved = await resolveSmtpConfig(account, ctx.secrets, credentials);
	if (!resolved.ok) {
		// `blocked` is distinct from `failed`: no auto-retry — the user has to
		// reconfigure the account first (issue #192).
		await ports.outboxMessage.update(accountConfigId, outboxMessageId, {
			status: "blocked",
			lastError: resolved.reason,
		});
		log.error({ accountId, reason: resolved.reason }, "SMTP not configured");
		return;
	}
	const smtpConfig = { ...resolved.config, getSocket: ctx.getSocket };

	// Below the budget a storage hiccup is retried like any other; at it the
	// record would dead-letter with the row at `queued`, which can be neither
	// sent again nor discarded (#845.8), so the row settles `failed` instead.
	const attachments = await loadOutboxAttachmentContents(
		{ attachments: ports.outboxAttachment, storage: ctx.storage },
		{ accountConfigId, accountId: account.accountId, outboxMessageId },
		Math.floor(Date.now() / 1000),
	).catch(async (error: unknown) => {
		if (receiveCount < ctx.maxAttempts) throw error;
		log.error(
			{ outboxMessageId, receiveCount, error: String(error) },
			"Attachments could not be loaded; settling the row as failed",
		);
		if (outbox.status !== OutboxMessageStatus.draft) {
			await ports.outboxMessage.updateIfStatus(
				accountConfigId,
				outboxMessageId,
				outbox.status,
				{
					status: OutboxMessageStatus.failed,
					lastError: attachmentFailureReason(error),
				},
			);
		}
		return null;
	});
	if (attachments === null) return;

	await ports.outboxMessage.updateStatus(
		accountConfigId,
		outboxMessageId,
		"sending",
	);

	const message = buildMailMessage(outbox, attachments);

	log.info(
		{ outboxMessageId, to: outbox.toAddresses, subject: outbox.subject },
		"Sending message via SMTP",
	);
	let result: SendResult;
	try {
		result = await sendMail(smtpConfig, message);
	} catch (err) {
		// A terminal SMTP auth rejection (e.g. expired OAuth token surfaced at
		// connect time) flips the account to reauth_required and ACKs.
		// Only OAuth accounts have a re-auth recovery path.
		if (
			err instanceof SmtpConnectionError &&
			err.kind === "auth" &&
			account.authType === AccountAuthType.OauthMicrosoft
		) {
			log.warn(
				{ accountId, errorKind: err.kind, error: err.message },
				"SMTP auth rejected during send; marking account reauth_required",
			);
			await updateConnectionState(
				ports,
				accountId,
				"reauth_required",
				err.message,
			);
			await settleBlockedOnReauth(OutboxMessageStatus.sending);
			return; // ACK — do not retry
		}
		// A password account's auth failure and every network failure retry on
		// SQS redelivery until the queue's own budget runs out, then settle
		// here instead of dead-lettering with the row stuck at `sending`
		// (issue #951). Where it settles is the double-send question:
		// `neverSubmitted` says the message cannot be on the server, so
		// `failed` offers the Retry the user needs; anything else settles
		// `unfiled`, the state that says a copy may be out there and which
		// Retry is not offered on. Wait-or-reconcile
		// (docs/architecture/imap-mutations.md R2): neither applies — a
		// submission leaves no server-side handle to reconcile against, so the
		// row settles on what the failure itself proves.
		if (err instanceof SmtpConnectionError) {
			if (receiveCount < ctx.maxAttempts) {
				throw err;
			}
			const settled = neverSubmitted(err)
				? { status: OutboxMessageStatus.failed, lastError: err.message }
				: {
						status: OutboxMessageStatus.unfiled,
						lastError: `${UNFILED_CONNECTION_LOST} (${err.message})`,
					};
			await ports.outboxMessage.update(
				accountConfigId,
				outboxMessageId,
				settled,
			);
			// Terminal and never re-thrown, so the handler-outcome series
			// records this record as a success. Counted here or it is invisible.
			ctx.recordSmtpFailure(err.kind);
			log.error(
				{
					outboxMessageId,
					errorKind: err.kind,
					receiveCount,
					status: settled.status,
				},
				"SMTP send retry exhausted; settling the row",
			);
			return; // ACK — settled terminal, no more retries
		}
		throw err;
	}

	if (result.success) {
		await ports.outboxMessage.markSent(accountConfigId, outboxMessageId, {
			sentAt: Date.now(),
			smtpMessageId: result.messageId,
		});
		log.info(
			{ outboxMessageId, smtpMessageId: result.messageId },
			"Message sent successfully",
		);

		await writeEngagementCounters(
			outbox,
			{ accountConfigId, accountId: account.accountId },
			engagementDeps(ports),
			log,
		).catch((error: unknown) => {
			log.warn(
				{ outboxMessageId, error: String(error) },
				"Failed to write engagement counters (best-effort)",
			);
		});

		// The filing is what deletes this row, so an enqueue that never lands
		// leaves it at `sent` — a delivered message the Outbox hides and no Sent
		// folder holds. Settle it here instead: the send itself is done, so
		// throwing would only redeliver an event that cannot re-send.
		await emitAppendSentMessage(ctx, accountId, outboxMessageId).catch(
			async (error: unknown) => {
				log.error(
					{ outboxMessageId, error: String(error) },
					"Failed to enqueue APPEND_SENT_MESSAGE; settling the row as unfiled",
				);
				await ports.outboxMessage.update(accountConfigId, outboxMessageId, {
					status: OutboxMessageStatus.unfiled,
					lastError: UNFILED_NOT_QUEUED,
				});
			},
		);
		return;
	}

	if (result.isTransient) {
		// A 4xx from the server is retried on SQS redelivery the same way a
		// connection failure is above; once the queue's own budget runs out
		// this settles the row at `failed` rather than leaving it at `queued`
		// forever once the record dead-letters (issue #951).
		if (receiveCount < ctx.maxAttempts) {
			log.warn(
				{
					outboxMessageId,
					smtpCode: result.smtpCode,
					error: result.error?.message,
				},
				"Transient failure, will retry",
			);
			await ports.outboxMessage.updateStatus(
				accountConfigId,
				outboxMessageId,
				"queued",
			);
			throw new Error(`SMTP transient error: ${result.error?.message}`);
		}

		await ports.outboxMessage.update(accountConfigId, outboxMessageId, {
			status: "failed",
			lastError: result.error?.message,
			lastSmtpCode: result.smtpCode,
		});
		// Terminal and never re-thrown, so the handler-outcome series records
		// this record as a success. Counted here or it is invisible.
		ctx.recordSmtpFailure("other");
		log.error(
			{
				outboxMessageId,
				smtpCode: result.smtpCode,
				error: result.error?.message,
				receiveCount,
			},
			"Transient failure retry exhausted; settling as failed",
		);
		return;
	}

	// Permanent failure - mark as failed, don't throw (no retry)
	await ports.outboxMessage.update(accountConfigId, outboxMessageId, {
		status: "failed",
		lastError: result.error?.message,
		lastSmtpCode: result.smtpCode,
	});
	log.error(
		{
			outboxMessageId,
			smtpCode: result.smtpCode,
			error: result.error?.message,
		},
		"Permanent failure",
	);
};
