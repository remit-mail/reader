import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { env } from "expect-env";
import type { ImapEvent } from "./events.js";

const sqs = new SQSClient({});
const queueUrl = env.SQS_QUEUE_URL;

export const emitEvent = async (
	event: Omit<ImapEvent, "eventId" | "timestamp">,
) => {
	const fullEvent: ImapEvent = {
		...event,
		eventId: randomUUID(),
		timestamp: Date.now(),
	} as ImapEvent;

	await sqs.send(
		new SendMessageCommand({
			QueueUrl: queueUrl,
			MessageBody: JSON.stringify(fullEvent),
		}),
	);
};
