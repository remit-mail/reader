import { randomUUID } from "node:crypto";
import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { IMailboxLockRepository } from "@remit/data-ports";

export type PendingMarkers = Pick<
	IMailboxLockRepository,
	"tryAcquireLock" | "releaseLock"
>;

export const SYNC_MAILBOXES_PENDING = "SYNC_MAILBOXES_PENDING";
export const SYNC_MAILBOXES_EXPLICIT_PENDING =
	"SYNC_MAILBOXES_EXPLICIT_PENDING";

export const syncMailboxesPendingName = (
	explicitRequest: boolean | undefined,
): string =>
	explicitRequest ? SYNC_MAILBOXES_EXPLICIT_PENDING : SYNC_MAILBOXES_PENDING;

export type TriggerSyncOutcome =
	| { enqueued: true; eventId: string }
	| { enqueued: false };

interface SyncMailboxesEvent {
	type: "SYNC_MAILBOXES";
	eventId: string;
	timestamp: number;
	accountId: string;
	explicitRequest?: boolean;
}

interface TriggerAccountSyncInput {
	sqsClient: SQSClient;
	markers: PendingMarkers;
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
	 * How often a timer may do that is bounded on the client, by the poll's own
	 * floor (`MIN_POLL_INTERVAL_MS` in the client hook, 30s) rather than by the
	 * gate: `mailboxPollIntervalSeconds` can lengthen the interval, never
	 * shorten it past that.
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
	input: Omit<TriggerAccountSyncInput, "sqsClient" | "markers">,
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
): Promise<TriggerSyncOutcome> => {
	const command = buildSyncMailboxesCommand(input);
	const body = command.input.MessageBody ?? "{}";
	const { eventId } = JSON.parse(body) as SyncMailboxesEvent;
	const markerName = syncMailboxesPendingName(input.explicitRequest);

	const acquired = await input.markers.tryAcquireLock(
		input.accountId,
		markerName,
		input.accountId,
		eventId,
	);
	if (!acquired) return { enqueued: false };

	await input.sqsClient.send(command).catch(async (error: unknown) => {
		await input.markers.releaseLock(
			input.accountId,
			input.accountId,
			markerName,
			eventId,
		);
		throw error;
	});
	return { enqueued: true, eventId };
};
