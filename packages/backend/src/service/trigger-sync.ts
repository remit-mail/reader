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
	 * Override the FIFO `MessageDeduplicationId`. Defaults to
	 * `SYNC_MAILBOXES:<accountId>`, the manual-trigger id (POST /sync, OAuth
	 * connect, pull-to-refresh) — every one of those call sites intentionally
	 * shares that id so a rapid double-tap collapses into one enqueue.
	 *
	 * The scheduled-sync tick (#1247) must NOT share that id: a 5-minute tick
	 * would then intermittently collide with its own prior tick (SQS FIFO's
	 * dedup window is 5 minutes) and with a concurrent manual trigger, silently
	 * dropping a due sync. Pass `buildScheduledSyncDedupId()` here instead.
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
			MessageDeduplicationId: dedupId ?? `SYNC_MAILBOXES:${accountId}`,
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
