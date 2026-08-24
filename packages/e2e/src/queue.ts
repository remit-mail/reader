/**
 * The queue the workers read, over the SQS protocol the deployment itself uses.
 *
 * Every other coordinate in this suite is something a user could reach. This
 * one is not, and it is here for the one thing no public surface can express:
 * an at-least-once queue delivering the same event twice. The app cannot be
 * asked to do that — a redelivery is the queue's doing, not the app's — so a
 * spec that wants one puts the event back itself.
 *
 * The sidecar answers the AWS Query protocol over plain form-encoded POSTs and
 * asks for no signature, so this needs no AWS SDK. Its responses are XML from
 * one hand-written serializer (`packages/queue-sidecar/src/protocol.ts`) with a
 * fixed element order, which is what makes reading them with a pattern safe
 * here and would not make it safe against a real endpoint.
 */
import { randomUUID } from "node:crypto";
import { waitFor } from "./api.js";
import { queueApi } from "./env.js";

/** Where APPEND_SENT_MESSAGE is delivered (`deploy/vps/queues.json`). */
export const MESSAGE_MGMT_QUEUE = "remit-message-mgmt";

/** Where a record that exhausts its redrive budget on that queue ends up. */
export const MESSAGE_MGMT_DLQ = "remit-message-mgmt-dlq";

const unescapeXml = (value: string): string =>
	value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");

/**
 * The sidecar resolves a queue by the last segment of `QueueUrl` or by
 * `QueueName` outright, so the suite names queues and leaves the account id in
 * a queue URL — an artefact of the AWS shape — out of its coordinates.
 */
const sqs = async (
	action: string,
	params: Record<string, string>,
): Promise<string> => {
	const response = await fetch(queueApi, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			Action: action,
			Version: "2012-11-05",
			...params,
		}),
	});
	const body = await response.text();
	if (!response.ok) {
		throw new Error(
			`${action} on the queue failed: ${response.status} ${body}`,
		);
	}
	return body;
};

/**
 * The APPEND_SENT_MESSAGE envelope, as the smtp-worker writes it and the
 * imap-worker reads it: `packages/smtp-worker/src/handlers/send-message.ts`
 * and `AppendSentMessageEvent` in `packages/imap-worker/src/events.ts`.
 *
 * Restated rather than imported because this suite depends on nothing in
 * `packages/` — it installs from the public registry alone, and a workspace
 * import would resolve for a monorepo checkout and for nothing else. What keeps
 * the restatement honest is the dispatch on the other side: an envelope the
 * worker cannot recognise throws, exhausts the queue's redrive budget and
 * arrives in `MESSAGE_MGMT_DLQ`, which is why every spec sending one reads that
 * queue afterwards. A silently ignored event is not a shape this can drift into.
 */
export const enqueueAppendSentMessage = async (
	accountId: string,
	outboxMessageId: string,
): Promise<void> => {
	await sqs("SendMessage", {
		QueueName: MESSAGE_MGMT_QUEUE,
		MessageBody: JSON.stringify({
			type: "APPEND_SENT_MESSAGE",
			accountId,
			outboxMessageId,
			eventId: randomUUID(),
			timestamp: Date.now(),
		}),
	});
};

const attributesOf = async (
	queueName: string,
): Promise<Record<string, string>> => {
	const body = await sqs("GetQueueAttributes", {
		QueueName: queueName,
		"AttributeName.1": "All",
	});
	const attributes: Record<string, string> = {};
	for (const [, name, value] of body.matchAll(
		/<Attribute><Name>([^<]*)<\/Name><Value>([^<]*)<\/Value><\/Attribute>/g,
	)) {
		attributes[name] = unescapeXml(value);
	}
	return attributes;
};

/**
 * Wait until a queue holds nothing, delivered or in flight.
 *
 * A record leaves a queue two ways: the consumer deletes it, or the redrive
 * policy moves it to the dead-letter queue. So an empty queue says the event
 * reached a worker and that worker finished with it — which is what makes the
 * assertions after it assertions about a redelivery that happened, rather than
 * about one still sitting on a queue.
 */
export const waitForQueueDrained = async (
	queueName: string,
	{ timeoutMs = 90_000 }: { timeoutMs?: number } = {},
): Promise<void> => {
	await waitFor(
		() => attributesOf(queueName),
		(attributes) =>
			attributes.ApproximateNumberOfMessages === "0" &&
			attributes.ApproximateNumberOfMessagesNotVisible === "0",
		{ timeoutMs, what: `${queueName} to drain` },
	);
};

/**
 * The bodies a queue is holding, read without taking them off it.
 *
 * `VisibilityTimeout=0` is what makes this a look rather than a receive: the
 * records are visible again the moment they are handed over, so reading a
 * dead-letter queue here cannot be what keeps a later reader from seeing what
 * is on it.
 */
export const readVisibleBodies = async (
	queueName: string,
): Promise<string[]> => {
	const body = await sqs("ReceiveMessage", {
		QueueName: queueName,
		MaxNumberOfMessages: "10",
		VisibilityTimeout: "0",
		WaitTimeSeconds: "0",
	});
	return [...body.matchAll(/<Body>([\s\S]*?)<\/Body>/g)].map(([, value]) =>
		unescapeXml(value),
	);
};
