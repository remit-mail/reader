import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import {
	AccountService,
	getClient,
	OutboxMessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import {
	createKmsDataKeyProvider,
	createSecretsService,
} from "@remit/secrets-service";
import { buildMailMessage, sendMail } from "@remit/smtp-service";
import { env } from "expect-env";
import type { SendMessageEvent } from "../events.js";
import { resolveSmtpConfig } from "./resolve-smtp-config.js";

const client = getClient();
const dataKeyProvider = createKmsDataKeyProvider(env.KMS_KEY_ID);
const secrets = createSecretsService(dataKeyProvider);

const accountService = new AccountService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});
const outboxService = new OutboxMessageService({
	client,
	table: env.DYNAMODB_TABLE_NAME,
});

// APPEND_SENT_MESSAGE is processed by the IMAP worker via the
// message-management queue (see remit-imap-worker/src/emit.ts).
const messageMgmtQueueUrl = env.SQS_QUEUE_URL_MESSAGE_MGMT;
const isLocalQueue = messageMgmtQueueUrl.startsWith("http://localhost");

const messageMgmtSqs = new SQSClient({
	endpoint: isLocalQueue ? new URL(messageMgmtQueueUrl).origin : undefined,
	...(isLocalQueue && { protocol: AwsQueryProtocol }),
});

const emitAppendSentMessage = async (
	accountId: string,
	outboxMessageId: string,
): Promise<void> => {
	const event = {
		type: "APPEND_SENT_MESSAGE" as const,
		accountId,
		outboxMessageId,
		eventId: randomUUID(),
		timestamp: Date.now(),
	};

	await messageMgmtSqs.send(
		new SendMessageCommand({
			QueueUrl: messageMgmtQueueUrl,
			MessageBody: JSON.stringify(event),
		}),
	);
};

export const handleSendMessage = async (
	event: SendMessageEvent,
	log: Logger,
): Promise<void> => {
	const { outboxMessageId, accountId } = event;

	log.info({ outboxMessageId, accountId }, "Processing send message event");

	// 1. Get outbox message
	const outbox = await outboxService.get(outboxMessageId);
	if (outbox.status === "sent") {
		log.info({ outboxMessageId }, "Message already sent, skipping");
		return;
	}

	// 2. Mark as sending
	await outboxService.updateStatus(outboxMessageId, "sending");

	// 3. Resolve SMTP config from the account, reusing IMAP credentials
	// when no dedicated SMTP password is stored (issue #163).
	const account = await accountService.get(accountId);
	const resolved = await resolveSmtpConfig(account, secrets);
	if (!resolved.ok) {
		await outboxService.update(outboxMessageId, {
			status: "failed",
			lastError: resolved.reason,
		});
		log.error({ accountId, reason: resolved.reason }, "SMTP not configured");
		return;
	}
	const smtpConfig = resolved.config;

	// 4. Build message (attachments not yet supported)
	const message = buildMailMessage(outbox);

	// 5. Send
	log.info(
		{ outboxMessageId, to: outbox.toAddresses, subject: outbox.subject },
		"Sending message via SMTP",
	);
	const result = await sendMail(smtpConfig, message);

	if (result.success) {
		await outboxService.update(outboxMessageId, {
			status: "sent",
			sentAt: Date.now(),
			smtpMessageId: result.messageId,
		});
		log.info(
			{ outboxMessageId, smtpMessageId: result.messageId },
			"Message sent successfully",
		);

		await emitAppendSentMessage(accountId, outboxMessageId).catch(
			(error: unknown) => {
				log.warn(
					{ outboxMessageId, error: String(error) },
					"Failed to enqueue APPEND_SENT_MESSAGE (best-effort)",
				);
			},
		);
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
		// Revert to queued so SQS retry picks it up
		await outboxService.updateStatus(outboxMessageId, "queued");
		throw new Error(`SMTP transient error: ${result.error?.message}`);
	}

	// Permanent failure - mark as failed, don't throw (no retry)
	await outboxService.update(outboxMessageId, {
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
