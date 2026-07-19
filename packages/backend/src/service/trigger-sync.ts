import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";

interface SyncMailboxesEvent {
	type: "SYNC_MAILBOXES";
	eventId: string;
	timestamp: number;
	accountId: string;
}

interface TriggerAccountSyncInput {
	sqsClient: SQSClient;
	queueUrl: string;
	accountId: string;
	/**
	 * Override the FIFO `MessageDeduplicationId`. Defaults to the event's own
	 * id, so the queue suppresses a re-send of one event and nothing else —
	 * every manual call site (POST /sync, OAuth connect, config load,
	 * pull-to-refresh, the client's online-poll) always enqueues. A shared,
	 * time-bucketed id instead turned SQS's 5-minute window into a rate limiter
	 * and silently discarded a sync the user asked for whenever one had run
	 * recently (issue #37).
	 *
	 * The scheduled-sync tick (#1247) passes `buildScheduledSyncDedupId()`,
	 * which is bucketed by the tick's own cadence: there it collapses a
	 * re-invocation of a single tick, never two ticks or a manual trigger.
	 */
	dedupId?: string;
}

const isFifoQueue = (queueUrl: string): boolean => queueUrl.endsWith(".fifo");

/**
 * Build the scheduler's own dedup namespace, bucketed by tick interval so
 * consecutive ticks each get a fresh id (never colliding with each other)
 * while still deduping a genuine double-invocation of the same tick (e.g. a
 * retried Lambda) — see `dedupId` above.
 */
export const buildScheduledSyncDedupId = (
	accountId: string,
	now: number,
	bucketMs: number,
): string => {
	const bucket = Math.floor(now / bucketMs);
	return `SYNC_MAILBOXES:scheduled:${accountId}:${bucket}`;
};

export const buildSyncMailboxesCommand = (
	input: TriggerAccountSyncInput,
): SendMessageCommand => {
	const { queueUrl, accountId, dedupId } = input;
	const event: SyncMailboxesEvent = {
		type: "SYNC_MAILBOXES",
		eventId: randomUUID(),
		timestamp: Date.now(),
		accountId,
	};

	const useFifo = isFifoQueue(queueUrl);

	return new SendMessageCommand({
		QueueUrl: queueUrl,
		MessageBody: JSON.stringify(event),
		...(useFifo && {
			MessageGroupId: accountId,
			MessageDeduplicationId: dedupId ?? event.eventId,
		}),
	});
};

export const triggerAccountSync = async (
	input: TriggerAccountSyncInput,
): Promise<{ eventId: string }> => {
	const command = buildSyncMailboxesCommand(input);
	await input.sqsClient.send(command);
	const body = command.input.MessageBody ?? "{}";
	const parsed = JSON.parse(body) as SyncMailboxesEvent;
	return { eventId: parsed.eventId };
};
