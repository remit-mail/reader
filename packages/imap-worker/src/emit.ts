import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { env } from "expect-env";
import type { ImapEvent } from "./events.js";

const defaultQueueUrl = env.SQS_QUEUE_URL;

const sqs = new SQSClient({
	endpoint: defaultQueueUrl.startsWith("http://localhost")
		? new URL(defaultQueueUrl).origin
		: undefined,
});

const queueUrlMap: Record<ImapEvent["type"], string> = {
	SYNC_MAILBOXES: process.env.SQS_QUEUE_URL_MAILBOXES ?? defaultQueueUrl,
	SYNC_MESSAGES: process.env.SQS_QUEUE_URL_MESSAGES ?? defaultQueueUrl,
	SYNC_MESSAGE_BODY: process.env.SQS_QUEUE_URL_BODY ?? defaultQueueUrl,
	SYNC_FLAGS: process.env.SQS_QUEUE_URL_FLAGS ?? defaultQueueUrl,
	MAILBOX_CREATE: process.env.SQS_QUEUE_URL_MAILBOX_MGMT ?? defaultQueueUrl,
	MAILBOX_RENAME: process.env.SQS_QUEUE_URL_MAILBOX_MGMT ?? defaultQueueUrl,
	MAILBOX_DELETE: process.env.SQS_QUEUE_URL_MAILBOX_MGMT ?? defaultQueueUrl,
};

export const emitEvent = async (
	event: Omit<ImapEvent, "eventId" | "timestamp">,
) => {
	const fullEvent: ImapEvent = {
		...event,
		eventId: randomUUID(),
		timestamp: Date.now(),
	} as ImapEvent;

	const queueUrl = queueUrlMap[event.type];

	await sqs.send(
		new SendMessageCommand({
			QueueUrl: queueUrl,
			MessageBody: JSON.stringify(fullEvent),
		}),
	);
};
