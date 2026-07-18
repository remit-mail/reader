import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { createQueueProducer } from "@remit/sqs-client/producer";

/**
 * SYNC_MESSAGE_BODY event structure (matches remit-imap-worker/events.ts). The
 * consumer falls back to `messageIds` when `messages` (id+uid pairs) is absent.
 */
interface SyncMessageBodyTarget {
	messageId: string;
	uid: number;
}

interface SyncMessageBodyEvent {
	type: "SYNC_MESSAGE_BODY";
	eventId: string;
	timestamp: number;
	accountId: string;
	mailboxId: string;
	messageIds: string[];
	messages?: SyncMessageBodyTarget[];
	/**
	 * Always true for this read-miss re-arm cue: the caller only reaches
	 * `requestBodySync` when a `/content` read found `bodyStorageKey` set but
	 * the storage object missing, so the worker must bypass its "already
	 * stored" skip guard and re-fetch even though the DB row is stale.
	 */
	force: true;
}

export interface BodySyncQueueLogger {
	info(obj: Record<string, unknown>, msg: string): void;
	error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: BodySyncQueueLogger = {
	info: () => {},
	error: () => {},
};

export interface BodySyncQueueConfig {
	sqsQueueUrl: string;
	sqsEndpoint?: string;
	logger?: BodySyncQueueLogger;
}

export interface RequestBodySyncInput {
	accountId: string;
	mailboxId: string;
	messageId: string;
	/** UID resolved at read time so the worker issues one FETCH without a lookup. */
	uid?: number;
}

/**
 * Re-arms the body-sync cue for a single message from the read path.
 *
 * The worker emits SYNC_MESSAGE_BODY during metadata sync; this service lets the
 * API re-emit that cue on demand when a body-fetch finds the storage object
 * missing (never synced, or lost). The subsequent client retry then resolves
 * once the worker has stored the body.
 *
 * A queue-send failure never rejects: the read path already returns a retryable
 * 202 to the caller, and a rejection here would land on the shared API event
 * loop and fail an unrelated in-flight request. It is logged loudly with an
 * alertable field instead.
 */
export class BodySyncQueueService {
	private sqs: SQSClient;
	private queueUrl: string;
	private log: BodySyncQueueLogger;

	constructor(config: BodySyncQueueConfig) {
		this.queueUrl = config.sqsQueueUrl;
		this.log = config.logger ?? noopLogger;
		this.sqs = createQueueProducer({
			queueUrl: config.sqsQueueUrl,
			endpoint: config.sqsEndpoint,
		});
	}

	requestBodySync = async (input: RequestBodySyncInput): Promise<void> => {
		const { accountId, mailboxId, messageId, uid } = input;
		const event: SyncMessageBodyEvent = {
			type: "SYNC_MESSAGE_BODY",
			eventId: randomUUID(),
			timestamp: Date.now(),
			accountId,
			mailboxId,
			messageIds: [messageId],
			...(uid !== undefined && { messages: [{ messageId, uid }] }),
			force: true,
		};

		const useFifo = this.queueUrl.endsWith(".fifo");

		await this.sqs
			.send(
				new SendMessageCommand({
					QueueUrl: this.queueUrl,
					MessageBody: JSON.stringify(event),
					...(useFifo && {
						MessageGroupId: accountId,
						MessageDeduplicationId: event.eventId,
					}),
				}),
			)
			.then(() => {
				this.log.info(
					{ eventId: event.eventId, accountId, mailboxId, messageId },
					"Re-armed SYNC_MESSAGE_BODY cue",
				);
			})
			.catch((error: unknown) => {
				this.log.error(
					{
						alert: "body_sync_cue_enqueue_failed",
						eventId: event.eventId,
						accountId,
						mailboxId,
						messageId,
						errorName: (error as { name?: string })?.name,
						errorCode:
							(error as { Code?: string })?.Code ??
							(error as { code?: string })?.code,
					},
					"Failed to re-arm SYNC_MESSAGE_BODY cue (read path returned a retryable 202)",
				);
			});
	};
}
