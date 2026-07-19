import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";

interface SyncMailboxesEvent {
	type: "SYNC_MAILBOXES";
	eventId: string;
	timestamp: number;
	accountId: string;
	requestedByUser?: boolean;
}

interface TriggerAccountSyncInput {
	sqsClient: SQSClient;
	queueUrl: string;
	accountId: string;
	/**
	 * Set only where a person asked for this sync (POST /sync — the refresh
	 * control and pull-to-refresh both land there). It travels on the event and
	 * tells the worker's fan-out to sync every mailbox even if one just ran; a
	 * trigger that fires as a side effect of something else (config load, OAuth
	 * connect, the scheduled tick) leaves it unset and takes the freshness gate.
	 * See `mailboxNeedsSync` in imap-worker's sync-mailboxes handler.
	 */
	requestedByUser?: boolean;
	/**
	 * Override the FIFO `MessageDeduplicationId`. Defaults to the event's own
	 * id, so the queue suppresses a re-send of one event and nothing else —
	 * every manual call site (POST /sync, OAuth connect, config load,
	 * pull-to-refresh, the client's online-poll) always enqueues. A shared,
	 * time-bucketed id instead turned SQS's 5-minute window into a rate limiter
	 * and silently discarded a sync the user asked for whenever one had run
	 * recently (issue #37). What a trigger costs is bounded in the worker's
	 * fan-out (`mailboxNeedsSync`), by skipping mailboxes not worth
	 * re-enumerating — never by dropping the trigger.
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
	const { queueUrl, accountId, dedupId, requestedByUser } = input;
	const event: SyncMailboxesEvent = {
		type: "SYNC_MAILBOXES",
		eventId: randomUUID(),
		timestamp: Date.now(),
		accountId,
		...(requestedByUser && { requestedByUser }),
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
