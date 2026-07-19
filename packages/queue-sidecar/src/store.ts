import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export interface QueueDefinition {
	readonly name: string;
	readonly fifo: boolean;
	readonly visibilityTimeoutSeconds: number;
	readonly deadLetterTargetName?: string;
	readonly maxReceiveCount?: number;
	readonly contentBasedDeduplication?: boolean;
}

export interface QueueRecord {
	readonly name: string;
	readonly fifo: boolean;
	readonly visibilityTimeoutSeconds: number;
	readonly deadLetterTargetName: string | null;
	readonly maxReceiveCount: number | null;
	readonly contentBasedDeduplication: boolean;
}

export interface SendResult {
	readonly messageId: string;
	readonly md5OfBody: string;
	readonly sequenceNumber: string | null;
	readonly deduplicated: boolean;
}

export interface ReceivedMessage {
	readonly messageId: string;
	readonly body: string;
	readonly md5OfBody: string;
	readonly receiptHandle: string;
	readonly receiveCount: number;
	readonly sentTimestamp: number;
	readonly firstReceivedTimestamp: number;
	readonly groupId: string | null;
	readonly sequenceNumber: string | null;
}

export interface QueueAttributes {
	readonly approximateNumberOfMessages: number;
	readonly approximateNumberOfMessagesNotVisible: number;
	readonly visibilityTimeout: number;
	readonly fifoQueue: boolean;
	readonly redrivePolicy: string | null;
}

interface QueueRow {
	name: string;
	fifo: number;
	visibility_timeout_seconds: number;
	dead_letter_target_name: string | null;
	max_receive_count: number | null;
	content_based_deduplication: number;
}

interface MessageRow {
	id: number;
	message_id: string;
	queue_name: string;
	body: string;
	md5_body: string;
	group_id: string | null;
	dedup_id: string | null;
	sequence_number: string | null;
	receive_count: number;
	visible_at: number;
	receipt_handle: string | null;
	sent_at: number;
	first_received_at: number | null;
}

const DEDUP_WINDOW_MS = 5 * 60 * 1000;

const md5Hex = (value: string): string =>
	createHash("md5").update(value, "utf8").digest("hex");

const toQueueRecord = (row: QueueRow): QueueRecord => ({
	name: row.name,
	fifo: row.fifo === 1,
	visibilityTimeoutSeconds: row.visibility_timeout_seconds,
	deadLetterTargetName: row.dead_letter_target_name,
	maxReceiveCount: row.max_receive_count,
	contentBasedDeduplication: row.content_based_deduplication === 1,
});

/**
 * SQLite-backed store for the queue sidecar. Owns its own database file and
 * schema, isolated from the application and search data (ADR constraint 4).
 * Every operation the SQS surface exposes maps to a method here; the HTTP layer
 * only translates the AWS Query protocol to and from these calls.
 *
 * FIFO ordering, visibility timeout, and dead-letter redrive are all decided
 * here so the behaviour is testable without a running HTTP server.
 */
export class QueueStore {
	private readonly db: Database.Database;
	private sequenceCounter: bigint;

	constructor(filename: string) {
		this.db = new Database(filename);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("busy_timeout = 5000");
		// FULL, not NORMAL: the outbox path makes durability non-negotiable
		// (ADR constraint 5) — a queued send lost is a mail the user believes
		// left but never did. FULL flushes the WAL on every commit, so a
		// committed send survives host power-loss, not only a process restart.
		// At this queue's write volume the extra fsync cost is irrelevant.
		this.db.pragma("synchronous = FULL");
		this.migrate();
		this.sequenceCounter = this.readMaxSequence();
	}

	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS queues (
				name TEXT PRIMARY KEY,
				fifo INTEGER NOT NULL DEFAULT 0,
				visibility_timeout_seconds INTEGER NOT NULL DEFAULT 30,
				dead_letter_target_name TEXT,
				max_receive_count INTEGER,
				content_based_deduplication INTEGER NOT NULL DEFAULT 0
			);
			CREATE TABLE IF NOT EXISTS messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				message_id TEXT NOT NULL UNIQUE,
				queue_name TEXT NOT NULL,
				body TEXT NOT NULL,
				md5_body TEXT NOT NULL,
				group_id TEXT,
				dedup_id TEXT,
				sequence_number TEXT,
				receive_count INTEGER NOT NULL DEFAULT 0,
				visible_at INTEGER NOT NULL DEFAULT 0,
				receipt_handle TEXT,
				sent_at INTEGER NOT NULL,
				first_received_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS messages_queue_order
				ON messages (queue_name, id);
			CREATE TABLE IF NOT EXISTS dedup (
				queue_name TEXT NOT NULL,
				dedup_id TEXT NOT NULL,
				message_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (queue_name, dedup_id)
			);
		`);
	}

	private readMaxSequence(): bigint {
		const row = this.db
			.prepare(
				"SELECT MAX(CAST(sequence_number AS INTEGER)) AS max FROM messages",
			)
			.get() as { max: number | null };
		return BigInt(row.max ?? 0);
	}

	private nextSequence(): string {
		this.sequenceCounter += 1n;
		return this.sequenceCounter.toString();
	}

	close(): void {
		this.db.close();
	}

	upsertQueue(def: QueueDefinition): QueueRecord {
		this.db
			.prepare(
				`INSERT INTO queues (
					name, fifo, visibility_timeout_seconds,
					dead_letter_target_name, max_receive_count,
					content_based_deduplication
				) VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(name) DO UPDATE SET
					fifo = excluded.fifo,
					visibility_timeout_seconds = excluded.visibility_timeout_seconds,
					dead_letter_target_name = excluded.dead_letter_target_name,
					max_receive_count = excluded.max_receive_count,
					content_based_deduplication = excluded.content_based_deduplication`,
			)
			.run(
				def.name,
				def.fifo ? 1 : 0,
				def.visibilityTimeoutSeconds,
				def.deadLetterTargetName ?? null,
				def.maxReceiveCount ?? null,
				def.contentBasedDeduplication ? 1 : 0,
			);
		const created = this.getQueue(def.name);
		if (!created) throw new Error(`queue ${def.name} vanished after upsert`);
		return created;
	}

	getQueue(name: string): QueueRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM queues WHERE name = ?")
			.get(name) as QueueRow | undefined;
		return row ? toQueueRecord(row) : undefined;
	}

	listQueues(): QueueRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM queues ORDER BY name")
			.all() as QueueRow[];
		return rows.map(toQueueRecord);
	}

	sendMessage(input: {
		queueName: string;
		body: string;
		groupId?: string;
		deduplicationId?: string;
		now?: number;
	}): SendResult {
		const queue = this.requireQueue(input.queueName);
		const now = input.now ?? Date.now();
		const md5 = md5Hex(input.body);

		const invalid = validateFifoSend(queue, input);
		if (invalid) throw invalid;

		const dedupId = queue.fifo
			? (input.deduplicationId ??
				(queue.contentBasedDeduplication ? md5 : undefined))
			: undefined;

		const send = this.db.transaction((): SendResult => {
			if (dedupId) {
				this.pruneDedup(input.queueName, now);
				const existing = this.db
					.prepare(
						"SELECT message_id FROM dedup WHERE queue_name = ? AND dedup_id = ?",
					)
					.get(input.queueName, dedupId) as { message_id: string } | undefined;
				if (existing) {
					const seq = this.db
						.prepare(
							"SELECT sequence_number FROM messages WHERE message_id = ?",
						)
						.get(existing.message_id) as
						| { sequence_number: string | null }
						| undefined;
					return {
						messageId: existing.message_id,
						md5OfBody: md5,
						sequenceNumber: seq?.sequence_number ?? null,
						deduplicated: true,
					};
				}
			}

			const messageId = randomUUID();
			const sequenceNumber = queue.fifo ? this.nextSequence() : null;
			this.db
				.prepare(
					`INSERT INTO messages (
						message_id, queue_name, body, md5_body, group_id,
						dedup_id, sequence_number, receive_count, visible_at,
						receipt_handle, sent_at, first_received_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, NULL)`,
				)
				.run(
					messageId,
					input.queueName,
					input.body,
					md5,
					input.groupId ?? null,
					dedupId ?? null,
					sequenceNumber,
					now,
				);

			if (dedupId) {
				this.db
					.prepare(
						"INSERT INTO dedup (queue_name, dedup_id, message_id, created_at) VALUES (?, ?, ?, ?)",
					)
					.run(input.queueName, dedupId, messageId, now);
			}

			return {
				messageId,
				md5OfBody: md5,
				sequenceNumber,
				deduplicated: false,
			};
		});

		return send();
	}

	receiveMessages(input: {
		queueName: string;
		maxMessages: number;
		visibilityTimeoutSeconds?: number;
		now?: number;
	}): ReceivedMessage[] {
		const queue = this.requireQueue(input.queueName);
		const now = input.now ?? Date.now();
		const visibilityTimeout =
			input.visibilityTimeoutSeconds ?? queue.visibilityTimeoutSeconds;

		const receive = this.db.transaction((): ReceivedMessage[] => {
			const inFlightGroups = new Set(
				(
					this.db
						.prepare(
							`SELECT DISTINCT group_id FROM messages
							WHERE queue_name = ? AND group_id IS NOT NULL
							AND visible_at > ?`,
						)
						.all(input.queueName, now) as { group_id: string }[]
				).map((r) => r.group_id),
			);

			const candidates = this.db
				.prepare(
					`SELECT * FROM messages
					WHERE queue_name = ? AND visible_at <= ?
					ORDER BY id ASC`,
				)
				.all(input.queueName, now) as MessageRow[];

			const picked: ReceivedMessage[] = [];
			const claimedGroups = new Set<string>();

			for (const candidate of candidates) {
				if (picked.length >= input.maxMessages) break;

				if (
					queue.maxReceiveCount !== null &&
					queue.deadLetterTargetName !== null &&
					candidate.receive_count >= queue.maxReceiveCount
				) {
					this.moveToDeadLetter(candidate, queue.deadLetterTargetName, now);
					continue;
				}

				if (queue.fifo && candidate.group_id !== null) {
					if (inFlightGroups.has(candidate.group_id)) continue;
					if (claimedGroups.has(candidate.group_id)) continue;
					claimedGroups.add(candidate.group_id);
				}

				const receiptHandle = randomUUID();
				const receiveCount = candidate.receive_count + 1;
				const firstReceived = candidate.first_received_at ?? now;
				this.db
					.prepare(
						`UPDATE messages SET
							receive_count = ?, visible_at = ?, receipt_handle = ?,
							first_received_at = ?
						WHERE id = ?`,
					)
					.run(
						receiveCount,
						now + visibilityTimeout * 1000,
						receiptHandle,
						firstReceived,
						candidate.id,
					);

				picked.push({
					messageId: candidate.message_id,
					body: candidate.body,
					md5OfBody: candidate.md5_body,
					receiptHandle,
					receiveCount,
					sentTimestamp: candidate.sent_at,
					firstReceivedTimestamp: firstReceived,
					groupId: candidate.group_id,
					sequenceNumber: candidate.sequence_number,
				});
			}

			return picked;
		});

		return receive();
	}

	deleteMessage(queueName: string, receiptHandle: string): void {
		this.requireQueue(queueName);
		this.db
			.prepare(
				"DELETE FROM messages WHERE queue_name = ? AND receipt_handle = ?",
			)
			.run(queueName, receiptHandle);
	}

	purgeQueue(queueName: string): void {
		this.requireQueue(queueName);
		this.db.prepare("DELETE FROM messages WHERE queue_name = ?").run(queueName);
	}

	getQueueAttributes(queueName: string, now = Date.now()): QueueAttributes {
		const queue = this.requireQueue(queueName);
		const visible = this.db
			.prepare(
				"SELECT COUNT(*) AS n FROM messages WHERE queue_name = ? AND visible_at <= ?",
			)
			.get(queueName, now) as { n: number };
		const notVisible = this.db
			.prepare(
				"SELECT COUNT(*) AS n FROM messages WHERE queue_name = ? AND visible_at > ?",
			)
			.get(queueName, now) as { n: number };

		return {
			approximateNumberOfMessages: visible.n,
			approximateNumberOfMessagesNotVisible: notVisible.n,
			visibilityTimeout: queue.visibilityTimeoutSeconds,
			fifoQueue: queue.fifo,
			redrivePolicy:
				queue.deadLetterTargetName !== null && queue.maxReceiveCount !== null
					? JSON.stringify({
							deadLetterTargetArn: `arn:aws:sqs:local:000000000000:${queue.deadLetterTargetName}`,
							maxReceiveCount: queue.maxReceiveCount,
						})
					: null,
		};
	}

	private moveToDeadLetter(
		message: MessageRow,
		deadLetterName: string,
		now: number,
	): void {
		this.db
			.prepare(
				`UPDATE messages SET
					queue_name = ?, receive_count = 0, visible_at = 0,
					receipt_handle = NULL, first_received_at = NULL, sent_at = ?
				WHERE id = ?`,
			)
			.run(deadLetterName, now, message.id);
	}

	private pruneDedup(queueName: string, now: number): void {
		this.db
			.prepare("DELETE FROM dedup WHERE queue_name = ? AND created_at < ?")
			.run(queueName, now - DEDUP_WINDOW_MS);
	}

	private requireQueue(name: string): QueueRecord {
		const queue = this.getQueue(name);
		if (!queue) throw new QueueDoesNotExistError(name);
		return queue;
	}
}

/**
 * An error that maps to an SQS Query wire fault. `code` is the SQS error code
 * the SDK deserializes into a named exception; `senderFault` decides Sender vs
 * Receiver (HTTP 400 vs 500).
 */
export class SqsError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly senderFault = true,
	) {
		super(message);
		this.name = new.target.name;
	}
}

export class QueueDoesNotExistError extends SqsError {
	constructor(public readonly queueName: string) {
		super(
			"AWS.SimpleQueueService.NonExistentQueue",
			`The specified queue does not exist: ${queueName}`,
		);
	}
}

export class MissingParameterError extends SqsError {
	constructor(message: string) {
		super("MissingParameter", message);
	}
}

export class InvalidParameterValueError extends SqsError {
	constructor(message: string) {
		super("InvalidParameterValue", message);
	}
}

export interface FifoSendInput {
	readonly groupId?: string;
	readonly deduplicationId?: string;
}

/**
 * The FIFO-send preconditions real SQS enforces, returned rather than thrown so
 * the batch path can map a bad entry to a per-entry failure instead of failing
 * the whole request. A standard queue has no preconditions.
 */
export const validateFifoSend = (
	queue: QueueRecord,
	input: FifoSendInput,
): SqsError | undefined => {
	if (!queue.fifo) return undefined;
	if (!input.groupId) {
		return new MissingParameterError(
			"The request must contain the parameter MessageGroupId.",
		);
	}
	if (!input.deduplicationId && !queue.contentBasedDeduplication) {
		return new InvalidParameterValueError(
			"The queue should either have ContentBasedDeduplication enabled or MessageDeduplicationId provided explicitly.",
		);
	}
	return undefined;
};
