import type {
	AccountItem,
	MessageItem,
	OutboxMessageItem,
	UpdateOutboxMessageInput,
} from "@remit/data-ports";
import { AccountAuthType, OutboxMessageStatus } from "@remit/domain-enums";
import { type Logger, recordSmtpFailure } from "@remit/logger-lambda";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import type { SecretsService } from "@remit/secrets-service";
import {
	buildMailMessage,
	type SendResult,
	SmtpConnectionError,
	type sendMail,
} from "@remit/smtp-service";
import type { SendMessageEvent } from "../events.js";
import { writeEngagementCounters } from "./engagement-counters.js";
import {
	resolveSmtpConfig,
	type SmtpCredentials,
} from "./resolve-smtp-config.js";

/** Tenant scope carried from the loaded account, never read off a looked-up row. */
export interface SendTenant {
	accountConfigId: string;
	accountId: string;
}

export interface EngagementCounterDeps {
	resolveAddressId: (accountConfigId: string, email: string) => string;
	incrementOutboundCount: (
		accountConfigId: string,
		addressId: string,
		now: number,
	) => Promise<void>;
	incrementReplyCount: (
		accountConfigId: string,
		addressId: string,
		now: number,
	) => Promise<void>;
	findMessageByHeader: (
		accountId: string,
		messageIdHeader: string,
	) => Promise<MessageItem | null>;
	getEnvelopeFromEmail: (messageId: string) => Promise<string | null>;
}

export interface SendMessageDeps {
	getOutbox: (
		accountConfigId: string,
		id: string,
	) => Promise<OutboxMessageItem>;
	getAccount: (id: string) => Promise<AccountItem>;
	updateOutbox: (
		accountConfigId: string,
		id: string,
		patch: UpdateOutboxMessageInput,
	) => Promise<unknown>;
	updateOutboxStatus: (
		accountConfigId: string,
		id: string,
		status: OutboxMessageItem["status"],
	) => Promise<unknown>;
	markOutboxSent: (
		accountConfigId: string,
		id: string,
		fields: { sentAt: number; smtpMessageId?: string },
	) => Promise<unknown>;
	secrets: Pick<SecretsService, "decrypt">;
	/**
	 * Resolve credentials for the account. Called after fetching the account.
	 * For password accounts this may resolve immediately from the stored hash.
	 * For OAuth accounts this mints an access token via the token service.
	 * Throws RefreshTokenError on OAuth failures — callers should not need to
	 * handle this here; the caller of sendMessage handles it.
	 */
	resolveCredentials: (account: AccountItem) => Promise<SmtpCredentials>;
	/**
	 * Persist the account's connectionState. Called when a terminal OAuth/SMTP
	 * auth failure is detected so the account is fenced off until the user
	 * re-auths (mirrors the IMAP withOAuthLifecycle contract).
	 */
	updateConnectionState: (accountId: string, state: string) => Promise<void>;
	send: typeof sendMail;
	emitAppendSentMessage: (
		accountId: string,
		outboxMessageId: string,
	) => Promise<void>;
	engagement: EngagementCounterDeps;
}

const UNFILED_NOT_QUEUED =
	"Sent, but not filed: the copy for the Sent folder could not be queued.";

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
 * Fallback when `SEND_MESSAGE_MAX_ATTEMPTS` is unset (local dev, unit tests).
 * Matches `remit-smtp`'s `maxReceiveCount` (`deploy/vps/queues.json`), same
 * pattern as `MESSAGE_MOVE_MAX_ATTEMPTS` / `FLAG_PUSH_MAX_ATTEMPTS` in
 * imap-worker.
 */
const DEFAULT_SEND_MESSAGE_MAX_ATTEMPTS = 3;

export const getSendMessageMaxAttempts = (
	processEnv: NodeJS.ProcessEnv = process.env,
): number => {
	const raw = processEnv.SEND_MESSAGE_MAX_ATTEMPTS;
	if (!raw) return DEFAULT_SEND_MESSAGE_MAX_ATTEMPTS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_SEND_MESSAGE_MAX_ATTEMPTS;
};

export const SEND_MESSAGE_MAX_ATTEMPTS = getSendMessageMaxAttempts();

export const sendMessage = async (
	event: SendMessageEvent,
	log: Logger,
	deps: SendMessageDeps,
	receiveCount = 1,
): Promise<void> => {
	const { outboxMessageId, accountId } = event;

	log.info({ outboxMessageId, accountId }, "Processing send message event");

	// Load the account first: its accountConfigId scopes every outbox lookup and
	// update. The worker's tenant comes from the account it loads by accountId,
	// never off the outbox row it fetches.
	const account = await deps.getAccount(accountId);
	const { accountConfigId } = account;

	const outbox = await deps.getOutbox(accountConfigId, outboxMessageId);
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
		log.info(
			{ accountId, connectionState: account.connectionState },
			"Account requires reauth, dropping send event",
		);
		return;
	}

	// Resolve credentials. On a terminal OAuth auth failure (token revoked),
	// flip the account to reauth_required and ACK — do not retry. Transient /
	// config failures rethrow for SQS retry/backoff.
	let credentials: SmtpCredentials;
	try {
		credentials = await deps.resolveCredentials(account);
	} catch (err) {
		if (err instanceof RefreshTokenError) {
			if (err.error.kind === "reauth-required") {
				log.warn(
					{ accountId, errorKind: err.error.kind, errorCode: err.error.code },
					"OAuth token revoked; marking account reauth_required",
				);
				await deps.updateConnectionState(accountId, "reauth_required");
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
				{ accountId, errorKind: err.kind },
				"SMTP auth rejected; marking account reauth_required",
			);
			await deps.updateConnectionState(accountId, "reauth_required");
			return; // ACK — do not retry
		}
		throw err;
	}
	const resolved = await resolveSmtpConfig(account, deps.secrets, credentials);
	if (!resolved.ok) {
		// `blocked` is distinct from `failed`: no auto-retry — the user has to
		// reconfigure the account first (issue #192).
		await deps.updateOutbox(accountConfigId, outboxMessageId, {
			status: "blocked",
			lastError: resolved.reason,
		});
		log.error({ accountId, reason: resolved.reason }, "SMTP not configured");
		return;
	}
	const smtpConfig = resolved.config;

	await deps.updateOutboxStatus(accountConfigId, outboxMessageId, "sending");

	const message = buildMailMessage(outbox);

	log.info(
		{ outboxMessageId, to: outbox.toAddresses, subject: outbox.subject },
		"Sending message via SMTP",
	);
	let result: SendResult;
	try {
		result = await deps.send(smtpConfig, message);
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
				{ accountId, errorKind: err.kind },
				"SMTP auth rejected during send; marking account reauth_required",
			);
			await deps.updateConnectionState(accountId, "reauth_required");
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
			if (receiveCount < SEND_MESSAGE_MAX_ATTEMPTS) {
				throw err;
			}
			const settled = neverSubmitted(err)
				? { status: OutboxMessageStatus.failed, lastError: err.message }
				: {
						status: OutboxMessageStatus.unfiled,
						lastError: `${UNFILED_CONNECTION_LOST} (${err.message})`,
					};
			await deps.updateOutbox(accountConfigId, outboxMessageId, settled);
			// Terminal and never re-thrown, so the handler-outcome series
			// records this record as a success. Counted here or it is invisible.
			recordSmtpFailure(err.kind);
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
		await deps.markOutboxSent(accountConfigId, outboxMessageId, {
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
			deps.engagement,
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
		await deps
			.emitAppendSentMessage(accountId, outboxMessageId)
			.catch(async (error: unknown) => {
				log.error(
					{ outboxMessageId, error: String(error) },
					"Failed to enqueue APPEND_SENT_MESSAGE; settling the row as unfiled",
				);
				await deps.updateOutbox(accountConfigId, outboxMessageId, {
					status: OutboxMessageStatus.unfiled,
					lastError: UNFILED_NOT_QUEUED,
				});
			});
		return;
	}

	if (result.isTransient) {
		// A 4xx from the server is retried on SQS redelivery the same way a
		// connection failure is above; once the queue's own budget runs out
		// this settles the row at `failed` rather than leaving it at `queued`
		// forever once the record dead-letters (issue #951).
		if (receiveCount < SEND_MESSAGE_MAX_ATTEMPTS) {
			log.warn(
				{
					outboxMessageId,
					smtpCode: result.smtpCode,
					error: result.error?.message,
				},
				"Transient failure, will retry",
			);
			await deps.updateOutboxStatus(accountConfigId, outboxMessageId, "queued");
			throw new Error(`SMTP transient error: ${result.error?.message}`);
		}

		await deps.updateOutbox(accountConfigId, outboxMessageId, {
			status: "failed",
			lastError: result.error?.message,
			lastSmtpCode: result.smtpCode,
		});
		// Terminal and never re-thrown, so the handler-outcome series records
		// this record as a success. Counted here or it is invisible.
		recordSmtpFailure("other");
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
	await deps.updateOutbox(accountConfigId, outboxMessageId, {
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
