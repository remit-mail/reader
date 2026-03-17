import { createHash, randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { env } from "expect-env";
import type {
	ImapEvent,
	SyncFlagsEvent,
	SyncMailboxesEvent,
	SyncMessageBodyEvent,
	SyncMessagesEvent,
} from "./events.js";

type EventInput = Omit<ImapEvent, "eventId" | "timestamp">;

const defaultQueueUrl = env.SQS_QUEUE_URL;
const isLocal = defaultQueueUrl.startsWith("http://localhost");

const sqs = new SQSClient({
	endpoint: isLocal ? new URL(defaultQueueUrl).origin : undefined,
	...(isLocal && { protocol: AwsQueryProtocol }),
});

const queueUrlMap: Record<ImapEvent["type"], string> = {
	SYNC_MAILBOXES: process.env.SQS_QUEUE_URL_MAILBOXES ?? defaultQueueUrl,
	SYNC_MESSAGES: process.env.SQS_QUEUE_URL_MESSAGES ?? defaultQueueUrl,
	SYNC_MESSAGE_BODY: process.env.SQS_QUEUE_URL_BODY ?? defaultQueueUrl,
	SYNC_FLAGS: process.env.SQS_QUEUE_URL_FLAGS ?? defaultQueueUrl,
	MAILBOX_CREATE: process.env.SQS_QUEUE_URL_MAILBOX_MGMT ?? defaultQueueUrl,
	MAILBOX_RENAME: process.env.SQS_QUEUE_URL_MAILBOX_MGMT ?? defaultQueueUrl,
	MAILBOX_DELETE: process.env.SQS_QUEUE_URL_MAILBOX_MGMT ?? defaultQueueUrl,
	MESSAGE_DELETE: process.env.SQS_QUEUE_URL_MESSAGE_MGMT ?? defaultQueueUrl,
	MESSAGE_MOVE: process.env.SQS_QUEUE_URL_MESSAGE_MGMT ?? defaultQueueUrl,
	MESSAGE_COPY: process.env.SQS_QUEUE_URL_MESSAGE_MGMT ?? defaultQueueUrl,
	EMPTY_TRASH: process.env.SQS_QUEUE_URL_MESSAGE_MGMT ?? defaultQueueUrl,
};

/**
 * FIFO queue event types that support deduplication.
 * Management events (MAILBOX_*, MESSAGE_*, EMPTY_TRASH) are not deduplicated
 * because each operation is unique.
 */
const fifoEventTypes = new Set([
	"SYNC_MAILBOXES",
	"SYNC_MESSAGES",
	"SYNC_MESSAGE_BODY",
	"SYNC_FLAGS",
]);

/**
 * Generate a deduplication ID for FIFO queue events.
 * SQS deduplication window is 5 minutes - duplicate messages within
 * this window are rejected.
 */
const getDeduplicationId = (event: EventInput): string | undefined => {
	switch (event.type) {
		case "SYNC_MAILBOXES": {
			const e = event as Omit<SyncMailboxesEvent, "eventId" | "timestamp">;
			return `SYNC_MAILBOXES:${e.accountId}`;
		}

		case "SYNC_MESSAGES": {
			const e = event as Omit<SyncMessagesEvent, "eventId" | "timestamp">;
			return `SYNC_MESSAGES:${e.mailboxId}`;
		}

		case "SYNC_FLAGS": {
			const e = event as Omit<SyncFlagsEvent, "eventId" | "timestamp">;
			return `SYNC_FLAGS:${e.mailboxId}`;
		}

		case "SYNC_MESSAGE_BODY": {
			const e = event as Omit<SyncMessageBodyEvent, "eventId" | "timestamp">;
			// Hash sorted messageIds for smarter deduplication
			const sortedIds = [...e.messageIds].sort().join(",");
			const hash = createHash("sha256").update(sortedIds).digest("hex");
			return `SYNC_MESSAGE_BODY:${hash.slice(0, 32)}`;
		}

		default:
			// Management events are not deduplicated
			return undefined;
	}
};

/**
 * Check if queue URL is a FIFO queue (ends with .fifo)
 */
const isFifoQueue = (queueUrl: string): boolean => queueUrl.endsWith(".fifo");

/**
 * Check if running against local ElasticMQ (doesn't support DelaySeconds on FIFO)
 */
const isLocalQueue = defaultQueueUrl.startsWith("http://localhost");

export interface EmitEventOptions {
	/**
	 * Delay delivery of the message by this many seconds (0-900).
	 * Useful for retry backoff to avoid overwhelming IMAP servers.
	 */
	delaySeconds?: number;
}

export const emitEvent = async (
	event: EventInput,
	options?: EmitEventOptions,
) => {
	const fullEvent: ImapEvent = {
		...event,
		eventId: randomUUID(),
		timestamp: Date.now(),
	} as ImapEvent;

	const queueUrl = queueUrlMap[event.type];
	const useFifo = isFifoQueue(queueUrl) && fifoEventTypes.has(event.type);

	// ElasticMQ FIFO queues don't support per-message DelaySeconds
	const useDelay = options?.delaySeconds && !isLocalQueue;

	await sqs.send(
		new SendMessageCommand({
			QueueUrl: queueUrl,
			MessageBody: JSON.stringify(fullEvent),
			// Delay delivery for retry backoff (skip for local ElasticMQ)
			...(useDelay && { DelaySeconds: options.delaySeconds }),
			// FIFO queue parameters - only set if queue is FIFO
			...(useFifo && {
				MessageGroupId: event.accountId,
				MessageDeduplicationId: getDeduplicationId(event),
			}),
		}),
	);
};
