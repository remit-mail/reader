import { randomUUID } from "node:crypto";
import { getClient } from "@remit/backend/client";
import type { FifoQueueProducer, QueueProducer } from "@remit/data-ports";
import { recordImapFailure } from "@remit/logger-lambda/metrics";
import type { ImapEvent } from "./events.js";
import type { WorkerQueues } from "./queues.js";

type EventInput = Omit<ImapEvent, "eventId" | "timestamp">;

export type EmitEvent = (event: EventInput) => Promise<void>;

type Send = (event: ImapEvent) => Promise<void>;

// The deduplication id is the event's own id, so the queue suppresses a
// re-send of one event (the retry SQS's own idempotency guard is for) and
// nothing else. A shared id per account or per mailbox instead made the
// 5-minute window a rate limiter: the second sync of a mailbox within five
// minutes was discarded before any worker saw it, so mail that arrived after
// a sync could not be fetched until the window elapsed (issue #37).
const fifo =
	(queue: FifoQueueProducer<ImapEvent>): Send =>
	(event) =>
		queue.send({
			body: event,
			groupId: event.accountId,
			deduplicationId: event.eventId,
		});

const standard =
	(queue: QueueProducer<ImapEvent>): Send =>
	(event) =>
		queue.send({ body: event });

export const SYNC_MESSAGES_PENDING = "SYNC_MESSAGES_PENDING";

const SYNC_MESSAGES_PENDING_TTL_SECONDS = 300;

const senderFor = (type: ImapEvent["type"], queues: WorkerQueues): Send => {
	switch (type) {
		case "SYNC_MAILBOXES":
			return fifo(queues.mailboxes);
		case "SYNC_MESSAGES":
			return fifo(queues.messages);
		// SYNC_MESSAGE_BODY routes to the single standard body queue (#612).
		case "SYNC_MESSAGE_BODY":
			return standard(queues.body);
		case "MAILBOX_CREATE":
		case "MAILBOX_RENAME":
		case "MAILBOX_DELETE":
			return standard(queues.mailboxManagement);
		case "MESSAGE_DELETE":
		case "MESSAGE_MOVE":
		case "MESSAGE_COPY":
		case "EMPTY_TRASH":
		case "APPEND_SENT_MESSAGE":
		// Rides messageMgmtQueue (issue #1271) rather than a dedicated queue — its
		// payload carries only our message id (never a UID, unlike the legacy
		// MESSAGE_MOVE event); per-event-type payload shape, same queue.
		case "PLACEMENT_MOVE_PUSH":
			return standard(queues.messageManagement);
		// Rides the existing flags queue (issue #1273) — this is imap-worker's OWN
		// re-arm hint (the periodic per-mailbox sync tick catching up a marker
		// stuck `pending`), distinct from `FlagPushService`'s user-facing hint
		// sent from the API onto the sync queue. Both land on a queue this worker
		// already consumes; dispatch is by `type`, not by which queue delivered
		// the message.
		case "FLAG_PUSH":
			return fifo(queues.flags);
	}
};

export const createEmitEvent =
	(queues: WorkerQueues): EmitEvent =>
	async (event) => {
		const fullEvent: ImapEvent = {
			...event,
			eventId: randomUUID(),
			timestamp: Date.now(),
		} as ImapEvent;

		const send = () => senderFor(fullEvent.type, queues)(fullEvent);
		if (fullEvent.type !== "SYNC_MESSAGES") {
			await send();
			return;
		}

		const { mailboxLock } = await getClient();
		const { accountId, mailboxId, eventId } = fullEvent;
		const previous = await mailboxLock.get(
			accountId,
			mailboxId,
			SYNC_MESSAGES_PENDING,
		);
		const acquired = await mailboxLock.tryAcquireLock(
			mailboxId,
			SYNC_MESSAGES_PENDING,
			accountId,
			eventId,
			SYNC_MESSAGES_PENDING_TTL_SECONDS,
		);
		if (!acquired) return;
		if (previous && previous.ttl < Math.floor(Date.now() / 1000)) {
			recordImapFailure("SYNC_PENDING_EXPIRED", "other");
		}

		await send().catch(async (error: unknown) => {
			await mailboxLock.releaseLock(
				accountId,
				mailboxId,
				SYNC_MESSAGES_PENDING,
				eventId,
			);
			throw error;
		});
	};
