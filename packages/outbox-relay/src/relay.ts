import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import {
	BODY_SYNCED_EVENT,
	MESSAGE_MOVED_EVENT,
	MESSAGE_REMOVED_EVENT,
	type PendingIndexEvent,
} from "./events.js";
import {
	toSearchIndexMessage,
	toSearchIndexRemoveMessage,
} from "./messages.js";

/**
 * The backend-specific half of the drain: read undrained outbox rows and mark
 * them processed. Postgres backs it with SQL over a `pg.Pool`; SQLite with
 * statements over its shared file. Both read the same-named columns, so the
 * relay logic above them is one implementation (RFC 036 D2).
 */
export interface OutboxStore {
	/** Every undrained drain event, distinct by (messageId, event). */
	listUnprocessedEvents(): Promise<PendingIndexEvent[]>;
	/**
	 * The undrained row ids for a message+event, captured BEFORE the relay reads
	 * message state, so a row appended mid-relay is never swallowed — it stays
	 * pending for the next pass. Never mark by `WHERE messageId AND event AND
	 * processedAt IS NULL`: that races the insert.
	 */
	listPendingRowIds(messageId: string, event: string): Promise<string[]>;
	markRowsProcessed(ids: string[]): Promise<void>;
}

export interface OutboxRelayConfig {
	store: OutboxStore;
	sqs: SQSClient;
	queueUrl: string;
}

const eventFor = (opts: { force: boolean; remove: boolean }): string =>
	opts.remove
		? MESSAGE_REMOVED_EVENT
		: opts.force
			? MESSAGE_MOVED_EVENT
			: BODY_SYNCED_EVENT;

/**
 * Relays committed outbox events onto the shared search-index SQS queue and
 * drains the rows it accounted for. The wake that drives it differs by backend
 * (Postgres LISTEN/NOTIFY + a lazy sweep; a 2-second poll on SQLite), but the
 * relay is identical: capture the pending row ids, send, then mark exactly those
 * ids drained. A row is drained once its event is durably handed to SQS — index
 * retries belong to SQS and its dead-letter queue, not the outbox. On a send
 * failure the rows stay pending (unmarked) and the next pass retries them.
 */
export class OutboxRelay {
	private readonly store: OutboxStore;
	private readonly sqs: SQSClient;
	private readonly queueUrl: string;

	constructor(config: OutboxRelayConfig) {
		this.store = config.store;
		this.sqs = config.sqs;
		this.queueUrl = config.queueUrl;
	}

	async enqueue(
		messageId: string,
		opts: { force: boolean; remove: boolean },
	): Promise<void> {
		const rowIds = await this.store.listPendingRowIds(
			messageId,
			eventFor(opts),
		);
		const body = opts.remove
			? toSearchIndexRemoveMessage(messageId)
			: toSearchIndexMessage(messageId, opts.force);
		await this.sqs.send(
			new SendMessageCommand({
				QueueUrl: this.queueUrl,
				MessageBody: JSON.stringify(body),
			}),
		);
		await this.store.markRowsProcessed(rowIds);
	}

	/**
	 * Relay every undrained event. Used at boot (catch wakes missed while down)
	 * and on the backstop cadence: if a row's wake was lost before it reached
	 * SQS, this re-relays it so no row can sit pending forever. Duplicate
	 * deliveries are idempotent via the consumer's content-hash gate.
	 */
	async drainPending(): Promise<number> {
		const pending = await this.store.listUnprocessedEvents();
		for (const { messageId, force, remove } of pending) {
			await this.enqueue(messageId, { force, remove });
		}
		return pending.length;
	}
}
