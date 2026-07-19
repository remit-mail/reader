import { randomUUID } from "node:crypto";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import {
	createQueueProducer,
	isLocalEndpoint,
} from "@remit/sqs-client/producer";
import { env } from "expect-env";
import type { ImapEvent } from "./events.js";

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

const isLocal = isLocalEndpoint(mailboxesQueueUrl);

const sqs = createQueueProducer({ queueUrl: mailboxesQueueUrl });

const queueUrlMap: Record<ImapEvent["type"], string> = {
	SYNC_MAILBOXES: mailboxesQueueUrl,
	SYNC_MESSAGES: messagesQueueUrl,
	SYNC_MESSAGE_BODY: bodyQueueUrl,
	MAILBOX_CREATE: mailboxMgmtQueueUrl,
	MAILBOX_RENAME: mailboxMgmtQueueUrl,
	MAILBOX_DELETE: mailboxMgmtQueueUrl,
	MESSAGE_DELETE: messageMgmtQueueUrl,
	MESSAGE_MOVE: messageMgmtQueueUrl,
	MESSAGE_COPY: messageMgmtQueueUrl,
	EMPTY_TRASH: messageMgmtQueueUrl,
	APPEND_SENT_MESSAGE: messageMgmtQueueUrl,
	// Rides messageMgmtQueue (issue #1271) rather than a dedicated queue — its
	// payload carries only our message id (never a UID, unlike the legacy
	// MESSAGE_MOVE event); per-event-type payload shape, same queue.
	PLACEMENT_MOVE_PUSH: messageMgmtQueueUrl,
	// Rides the existing flags queue (issue #1273) — this is imap-worker's OWN
	// re-arm hint (the periodic per-mailbox sync tick catching up a marker
	// stuck `pending`), distinct from `FlagPushService`'s user-facing hint
	// (remit-mailbox-service, sent from the API on its own SQS client onto
	// SQS_QUEUE_URL). Both land on a queue this worker already consumes;
	// dispatch is by `type`, not by which queue delivered the message.
	FLAG_PUSH: flagsQueueUrl,
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
	const useFifo = isFifoQueue(queueUrl);

	// ElasticMQ FIFO queues don't support per-message DelaySeconds
	const useDelay = options?.delaySeconds && !isLocal;

	await sqs.send(
		new SendMessageCommand({
			QueueUrl: queueUrl,
			MessageBody: JSON.stringify(fullEvent),
			// Delay delivery for retry backoff (skip for local ElasticMQ)
			...(useDelay && { DelaySeconds: options.delaySeconds }),
			// FIFO queue parameters — only set if the queue is FIFO. The
			// deduplication id is the event's own id, so the queue suppresses a
			// re-send of one event (the retry SQS's own idempotency guard is for)
			// and nothing else. A shared id per account or per mailbox instead made
			// the 5-minute window a rate limiter: the second sync of a mailbox
			// within five minutes was discarded before any worker saw it, so mail
			// that arrived after a sync could not be fetched until the window
			// elapsed (issue #37). Repeated work is bounded where it belongs —
			// MessageGroupId serializes an account's events, and MailboxLockService
			// collapses a sync that overlaps one already running.
			...(useFifo && {
				MessageGroupId: event.accountId,
				MessageDeduplicationId: fullEvent.eventId,
			}),
		}),
	);
};
