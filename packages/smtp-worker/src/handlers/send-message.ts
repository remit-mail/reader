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
import { sendMail } from "@remit/smtp-service";
import { env } from "expect-env";
import type { SendMessageEvent } from "../events.js";
import { sendMessage } from "./send-message-core.js";

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

export const handleSendMessage = (
	event: SendMessageEvent,
	log: Logger,
): Promise<void> =>
	sendMessage(event, log, {
		getOutbox: (id) => outboxService.get(id),
		getAccount: (id) => accountService.get(id),
		updateOutbox: (id, patch) => outboxService.update(id, patch),
		updateOutboxStatus: (id, status) => outboxService.updateStatus(id, status),
		markOutboxSent: (id, fields) => outboxService.markSent(id, fields),
		secrets,
		send: sendMail,
		emitAppendSentMessage,
	});
