import type {
	AccountItem,
	MessageItem,
	OutboxMessageItem,
	UpdateOutboxMessageInput,
} from "@remit/remit-electrodb-service";
import { AccountAuthType } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
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

export interface EngagementCounterDeps {
	resolveAddressId: (accountConfigId: string, email: string) => string;
	incrementOutboundCount: (addressId: string, now: number) => Promise<void>;
	incrementReplyCount: (addressId: string, now: number) => Promise<void>;
	findMessageByHeader: (
		accountId: string,
		messageIdHeader: string,
	) => Promise<MessageItem | null>;
	getEnvelopeFromEmail: (messageId: string) => Promise<string | null>;
}

export interface SendMessageDeps {
	getOutbox: (id: string) => Promise<OutboxMessageItem>;
	getAccount: (id: string) => Promise<AccountItem>;
	updateOutbox: (
		id: string,
		patch: UpdateOutboxMessageInput,
	) => Promise<unknown>;
	updateOutboxStatus: (
		id: string,
		status: OutboxMessageItem["status"],
	) => Promise<unknown>;
	markOutboxSent: (
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

export const sendMessage = async (
	event: SendMessageEvent,
	log: Logger,
	deps: SendMessageDeps,
): Promise<void> => {
	const { outboxMessageId, accountId } = event;

	log.info({ outboxMessageId, accountId }, "Processing send message event");

	const outbox = await deps.getOutbox(outboxMessageId);
	if (outbox.status === "sent") {
		log.info({ outboxMessageId }, "Message already sent, skipping");
		return;
	}

	// Resolve SMTP config before flipping to `sending` so a blocked-config send
	// does not transient-flicker through "Sending..." in the UI (issue #192).
	const account = await deps.getAccount(accountId);

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
		await deps.updateOutbox(outboxMessageId, {
			status: "blocked",
			lastError: resolved.reason,
		});
		log.error({ accountId, reason: resolved.reason }, "SMTP not configured");
		return;
	}
	const smtpConfig = resolved.config;

	await deps.updateOutboxStatus(outboxMessageId, "sending");

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
		// Only OAuth accounts have a re-auth recovery path. For password
		// accounts, rethrow to preserve pre-PR batch-item-failure behaviour.
		if (err instanceof SmtpConnectionError && err.kind === "auth") {
			if (account.authType !== AccountAuthType.OauthMicrosoft) {
				throw err;
			}
			log.warn(
				{ accountId, errorKind: err.kind },
				"SMTP auth rejected during send; marking account reauth_required",
			);
			await deps.updateConnectionState(accountId, "reauth_required");
			return; // ACK — do not retry
		}
		throw err;
	}

	if (result.success) {
		await deps.markOutboxSent(outboxMessageId, {
			sentAt: Date.now(),
			smtpMessageId: result.messageId,
		});
		log.info(
			{ outboxMessageId, smtpMessageId: result.messageId },
			"Message sent successfully",
		);

		await writeEngagementCounters(outbox, deps.engagement, log).catch(
			(error: unknown) => {
				log.warn(
					{ outboxMessageId, error: String(error) },
					"Failed to write engagement counters (best-effort)",
				);
			},
		);

		await deps
			.emitAppendSentMessage(accountId, outboxMessageId)
			.catch((error: unknown) => {
				log.warn(
					{ outboxMessageId, error: String(error) },
					"Failed to enqueue APPEND_SENT_MESSAGE (best-effort)",
				);
			});
		return;
	}

	if (result.isTransient) {
		log.warn(
			{
				outboxMessageId,
				smtpCode: result.smtpCode,
				error: result.error?.message,
			},
			"Transient failure, will retry",
		);
		await deps.updateOutboxStatus(outboxMessageId, "queued");
		throw new Error(`SMTP transient error: ${result.error?.message}`);
	}

	// Permanent failure - mark as failed, don't throw (no retry)
	await deps.updateOutbox(outboxMessageId, {
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
