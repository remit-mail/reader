import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
	AccountService,
	getClient,
	OutboxMessageService,
} from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";
import {
	createKmsDataKeyProvider,
	createSecretsService,
	deserializeEncryptedPayload,
} from "@remit/secrets-service";
import {
	buildMailMessage,
	type SmtpConfig,
	sendMail,
} from "@remit/smtp-service";
import { env } from "expect-env";
import type { SendMessageEvent } from "../events.js";

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

const imapQueueUrl = env.SQS_QUEUE_URL_IMAP;
const isLocalQueue = imapQueueUrl.startsWith("http://localhost");

const imapSqs = new SQSClient({
	endpoint: isLocalQueue ? new URL(imapQueueUrl).origin : undefined,
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

	await imapSqs.send(
		new SendMessageCommand({
			QueueUrl: imapQueueUrl,
			MessageBody: JSON.stringify(event),
			MessageGroupId: accountId,
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

	// 3. Get account and validate SMTP configuration
	const account = await accountService.get(accountId);
	if (!account.smtpHost || !account.smtpPort || !account.smtpPasswordHash) {
		await outboxService.update(outboxMessageId, {
			status: "failed",
			lastError: "SMTP not configured for this account",
		});
		log.error({ accountId }, "SMTP not configured");
		return;
	}

	// 4. Decrypt SMTP credentials
	const smtpPassword = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(account.smtpPasswordHash)),
	);

	// 5. Build SMTP config
	const smtpConfig: SmtpConfig = {
		host: account.smtpHost,
		port: account.smtpPort,
		secure: account.smtpTls ?? false,
		auth: {
			user: account.smtpUsername ?? account.username,
			pass: smtpPassword,
		},
	};

	// 6. Build message (attachments not yet supported)
	const message = buildMailMessage(outbox);

	// 7. Send
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
