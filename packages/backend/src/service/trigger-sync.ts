import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";

interface SyncMailboxesEvent {
	type: "SYNC_MAILBOXES";
	eventId: string;
	timestamp: number;
	accountId: string;
	explicitRequest?: boolean;
}

interface TriggerAccountSyncInput {
	sqsClient: SQSClient;
	queueUrl: string;
	accountId: string;
	/**
	 * Set by POST /sync, whose callers ask for a sync of one named account: the
	 * refresh control, pull-to-refresh, and the web client's automatic poll
	 * (`useStaleAccountSync`) — a timer, not a person. It travels on the event
	 * and makes the worker's fan-out sync every mailbox even if one just ran.
	 *
	 * Everything else triggers a sync as a side effect of doing something else
	 * (config load, OAuth connect, account create, the scheduled tick), leaves
	 * this unset, and takes the freshness gate — see `mailboxNeedsSync` in
	 * imap-worker's sync-mailboxes handler.
	 *
	 * The poll cannot use this to outrun the gate: its interval is floored at
	 * the gate's own window (`MIN_POLL_INTERVAL_MS` in the client hook), so
	 * however low `mailboxPollIntervalSeconds` is set, a timer never fans out
	 * more often than the gate would have allowed anyway.
	 */
	explicitRequest?: boolean;
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
	const { queueUrl, accountId, dedupId, explicitRequest } = input;
	const event: SyncMailboxesEvent = {
		type: "SYNC_MAILBOXES",
		eventId: randomUUID(),
		timestamp: Date.now(),
		accountId,
		...(explicitRequest && { explicitRequest }),
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
