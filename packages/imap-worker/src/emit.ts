import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";
import { env } from "expect-env";
import type {
	ImapEvent,
	SyncFlagsEvent,
	SyncMailboxesEvent,
	SyncMessagesEvent,
} from "./events.js";

type EventInput = Omit<ImapEvent, "eventId" | "timestamp">;

const mailboxesQueueUrl = env.SQS_QUEUE_URL_MAILBOXES;
const messagesQueueUrl = env.SQS_QUEUE_URL_MESSAGES;
// SYNC_MESSAGE_BODY events route to the single standard body queue (#612). It is
// a standard (non-FIFO) queue, so isFifoQueue() below skips the FIFO
// MessageGroupId/dedup parameters automatically.
const bodyQueueUrl = env.SQS_QUEUE_URL_BODY;
const flagsQueueUrl = env.SQS_QUEUE_URL_FLAGS;
const mailboxMgmtQueueUrl = env.SQS_QUEUE_URL_MAILBOX_MGMT;
const messageMgmtQueueUrl = env.SQS_QUEUE_URL_MESSAGE_MGMT;

const isLocal = mailboxesQueueUrl.startsWith("http://localhost");

const sqs = new SQSClient({
	endpoint: isLocal ? new URL(mailboxesQueueUrl).origin : undefined,
	...(isLocal && { protocol: AwsQueryProtocol }),
});

const queueUrlMap: Record<ImapEvent["type"], string> = {
	SYNC_MAILBOXES: mailboxesQueueUrl,
	SYNC_MESSAGES: messagesQueueUrl,
	SYNC_MESSAGE_BODY: bodyQueueUrl,
	SYNC_FLAGS: flagsQueueUrl,
	MAILBOX_CREATE: mailboxMgmtQueueUrl,
	MAILBOX_RENAME: mailboxMgmtQueueUrl,
	MAILBOX_DELETE: mailboxMgmtQueueUrl,
	MESSAGE_DELETE: messageMgmtQueueUrl,
	MESSAGE_MOVE: messageMgmtQueueUrl,
	MESSAGE_COPY: messageMgmtQueueUrl,
	EMPTY_TRASH: messageMgmtQueueUrl,
	APPEND_SENT_MESSAGE: messageMgmtQueueUrl,
};

/**
 * FIFO queue event types that support deduplication.
 * Management events (MAILBOX_*, MESSAGE_*, EMPTY_TRASH) are not deduplicated
 * because each operation is unique.
 */
const fifoEventTypes = new Set([
	"SYNC_MAILBOXES",
	"SYNC_MESSAGES",
	"SYNC_FLAGS",
]);

/**
 * Generate a deduplication ID for FIFO queue events.
 * SQS deduplication window is 5 minutes - duplicate messages within
 * this window are rejected.
 */
export const getDeduplicationId = (event: EventInput): string | undefined => {
	switch (event.type) {
		case "SYNC_MAILBOXES": {
			const e = event as Omit<SyncMailboxesEvent, "eventId" | "timestamp">;
			return `SYNC_MAILBOXES:${e.accountId}`;
		}

		case "SYNC_MESSAGES": {
			const e = event as Omit<SyncMessagesEvent, "eventId" | "timestamp">;
			// A continuation carries a per-batch cursor so batches 2..N are not
			// deduped against the initial event (which has none) or each other; the
			// cursor-less initial id still dedups concurrent fresh syncs of a mailbox.
			return e.resumeCursor === undefined
				? `SYNC_MESSAGES:${e.mailboxId}`
				: `SYNC_MESSAGES:${e.mailboxId}:${e.resumeCursor}`;
		}

		case "SYNC_FLAGS": {
			const e = event as Omit<SyncFlagsEvent, "eventId" | "timestamp">;
			return `SYNC_FLAGS:${e.mailboxId}`;
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
	const useDelay = options?.delaySeconds && !isLocal;

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
