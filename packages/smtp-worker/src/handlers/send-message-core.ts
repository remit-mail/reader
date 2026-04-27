import type {
	AccountItem,
	OutboxMessageItem,
	UpdateOutboxMessageInput,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import type { SecretsService } from "@remit/secrets-service";
import {
	buildMailMessage,
	type SendResult,
	type sendMail,
} from "@remit/smtp-service";
import type { SendMessageEvent } from "../events.js";
import { resolveSmtpConfig } from "./resolve-smtp-config.js";

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
	send: typeof sendMail;
	emitAppendSentMessage: (
		accountId: string,
		outboxMessageId: string,
	) => Promise<void>;
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
	const resolved = await resolveSmtpConfig(account, deps.secrets);
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
	const result: SendResult = await deps.send(smtpConfig, message);

	if (result.success) {
		await deps.markOutboxSent(outboxMessageId, {
			sentAt: Date.now(),
			smtpMessageId: result.messageId,
		});
		log.info(
			{ outboxMessageId, smtpMessageId: result.messageId },
			"Message sent successfully",
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
