import { createHash, randomUUID } from "node:crypto";
import { openSqlite, type SqliteHandle } from "@remit/drizzle-service/sqlite";
import { and, asc, count, eq, gt, lt, lte, sql } from "drizzle-orm";
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

const queues = sqliteTable("queues", {
	name: text("name").primaryKey(),
	fifo: integer("fifo").notNull().default(0),
	visibilityTimeoutSeconds: integer("visibility_timeout_seconds")
		.notNull()
		.default(30),
	deadLetterTargetName: text("dead_letter_target_name"),
	maxReceiveCount: integer("max_receive_count"),
	contentBasedDeduplication: integer("content_based_deduplication")
		.notNull()
		.default(0),
});

const messages = sqliteTable("messages", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	messageId: text("message_id").notNull(),
	queueName: text("queue_name").notNull(),
	body: text("body").notNull(),
	md5Body: text("md5_body").notNull(),
	groupId: text("group_id"),
	dedupId: text("dedup_id"),
	sequenceNumber: text("sequence_number"),
	receiveCount: integer("receive_count").notNull().default(0),
	visibleAt: integer("visible_at").notNull().default(0),
	receiptHandle: text("receipt_handle"),
	sentAt: integer("sent_at").notNull(),
	firstReceivedAt: integer("first_received_at"),
});

const dedup = sqliteTable(
	"dedup",
	{
		queueName: text("queue_name").notNull(),
		dedupId: text("dedup_id").notNull(),
		messageId: text("message_id").notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [primaryKey({ columns: [table.queueName, table.dedupId] })],
);

const releaseRedrive = sqliteTable("release_redrive", {
	id: integer("id").primaryKey(),
	release: text("release").notNull(),
});

const schema = { queues, messages, dedup, releaseRedrive };

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

type QueueRow = typeof queues.$inferSelect;

type MessageRow = typeof messages.$inferSelect;

const DEDUP_WINDOW_MS = 5 * 60 * 1000;

const IMMEDIATE = { behavior: "immediate" } as const;

const md5Hex = (value: string): string =>
	createHash("md5").update(value, "utf8").digest("hex");

const toQueueRecord = (row: QueueRow): QueueRecord => ({
	name: row.name,
	fifo: row.fifo === 1,
	visibilityTimeoutSeconds: row.visibilityTimeoutSeconds,
	deadLetterTargetName: row.deadLetterTargetName,
	maxReceiveCount: row.maxReceiveCount,
	contentBasedDeduplication: row.contentBasedDeduplication === 1,
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
	private readonly handle: SqliteHandle<typeof schema>;
	private readonly db: SqliteHandle<typeof schema>["db"];
	private sequenceCounter: bigint;
	private readonly startedAt = Date.now();
	private readonly lastReceiveAt = new Map<string, number>();

	constructor(filename: string) {
		// FULL, not NORMAL: the outbox path makes durability non-negotiable
		// (ADR constraint 5) — a queued send lost is a mail the user believes
		// left but never did. FULL flushes the WAL on every commit, so a
		// committed send survives host power-loss, not only a process restart.
		// At this queue's write volume the extra fsync cost is irrelevant.
		this.handle = openSqlite({
			filename,
			mode: "create",
			synchronous: "FULL",
			schema,
		});
		this.db = this.handle.db;
		this.migrate();
		this.sequenceCounter = this.readMaxSequence();
	}

	private migrate(): void {
		this.handle.exec(`
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
			CREATE INDEX IF NOT EXISTS messages_queue_group
				ON messages (queue_name, group_id, id);
			CREATE TABLE IF NOT EXISTS dedup (
				queue_name TEXT NOT NULL,
				dedup_id TEXT NOT NULL,
				message_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (queue_name, dedup_id)
			);
			CREATE TABLE IF NOT EXISTS release_redrive (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				release TEXT NOT NULL
			);
		`);
	}

	private readMaxSequence(): bigint {
		const row = this.db
			.select({
				max: sql<
					number | null
				>`MAX(CAST(${messages.sequenceNumber} AS INTEGER))`,
			})
			.from(messages)
			.get();
		return BigInt(row?.max ?? 0);
	}

	private nextSequence(): string {
		this.sequenceCounter += 1n;
		return this.sequenceCounter.toString();
	}

	close(): void {
		this.handle.close();
	}

	upsertQueue(def: QueueDefinition): QueueRecord {
		const settings = {
			fifo: def.fifo ? 1 : 0,
			visibilityTimeoutSeconds: def.visibilityTimeoutSeconds,
			deadLetterTargetName: def.deadLetterTargetName ?? null,
			maxReceiveCount: def.maxReceiveCount ?? null,
			contentBasedDeduplication: def.contentBasedDeduplication ? 1 : 0,
		};
		this.db
			.insert(queues)
			.values({ name: def.name, ...settings })
			.onConflictDoUpdate({ target: queues.name, set: settings })
			.run();
		const created = this.getQueue(def.name);
		if (!created) throw new Error(`queue ${def.name} vanished after upsert`);
		return created;
	}

	getQueue(name: string): QueueRecord | undefined {
		const row = this.db
			.select()
			.from(queues)
			.where(eq(queues.name, name))
			.get();
		return row ? toQueueRecord(row) : undefined;
	}

	listQueues(): QueueRecord[] {
		const rows = this.db.select().from(queues).orderBy(asc(queues.name)).all();
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

		return this.db.transaction((): SendResult => {
			if (dedupId) {
				this.pruneDedup(input.queueName, now);
				const existing = this.db
					.select({ messageId: dedup.messageId })
					.from(dedup)
					.where(
						and(
							eq(dedup.queueName, input.queueName),
							eq(dedup.dedupId, dedupId),
						),
					)
					.get();
				if (existing) {
					const seq = this.db
						.select({ sequenceNumber: messages.sequenceNumber })
						.from(messages)
						.where(eq(messages.messageId, existing.messageId))
						.get();
					return {
						messageId: existing.messageId,
						md5OfBody: md5,
						sequenceNumber: seq?.sequenceNumber ?? null,
						deduplicated: true,
					};
				}
			}

			const messageId = randomUUID();
			const sequenceNumber = queue.fifo ? this.nextSequence() : null;
			this.insertMessage({
				messageId,
				queueName: input.queueName,
				body: input.body,
				md5Body: md5,
				groupId: input.groupId ?? null,
				dedupId: dedupId ?? null,
				sequenceNumber,
				sentAt: now,
			});

			if (dedupId) {
				this.db
					.insert(dedup)
					.values({
						queueName: input.queueName,
						dedupId,
						messageId,
						createdAt: now,
					})
					.run();
			}

			return {
				messageId,
				md5OfBody: md5,
				sequenceNumber,
				deduplicated: false,
			};
		}, IMMEDIATE);
	}

	private insertMessage(message: typeof messages.$inferInsert): void {
		this.db.insert(messages).values(message).run();
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

		const received = this.db.transaction((): ReceivedMessage[] => {
			const picked: ReceivedMessage[] = [];

			for (const candidate of this.nextCandidates(
				queue,
				now,
				input.maxMessages,
			)) {
				if (
					queue.maxReceiveCount !== null &&
					queue.deadLetterTargetName !== null &&
					candidate.receiveCount >= queue.maxReceiveCount
				) {
					this.db
						.update(messages)
						.set({ queueName: queue.deadLetterTargetName })
						.where(eq(messages.id, candidate.id))
						.run();
					continue;
				}

				const receiptHandle = randomUUID();
				const receiveCount = candidate.receiveCount + 1;
				const firstReceived = candidate.firstReceivedAt ?? now;
				this.db
					.update(messages)
					.set({
						receiveCount,
						visibleAt: now + visibilityTimeout * 1000,
						receiptHandle,
						firstReceivedAt: firstReceived,
					})
					.where(eq(messages.id, candidate.id))
					.run();

				picked.push({
					messageId: candidate.messageId,
					body: candidate.body,
					md5OfBody: candidate.md5Body,
					receiptHandle,
					receiveCount,
					sentTimestamp: candidate.sentAt,
					firstReceivedTimestamp: firstReceived,
					groupId: candidate.groupId,
					sequenceNumber: candidate.sequenceNumber,
				});
			}

			return picked;
		}, IMMEDIATE);

		if (received.length > 0) this.lastReceiveAt.set(input.queueName, now);
		return received;
	}

	lastReceiveAgeSeconds(queueName: string, now = Date.now()): number {
		this.requireQueue(queueName);
		const since = this.lastReceiveAt.get(queueName) ?? this.startedAt;
		return Math.max(0, Math.floor((now - since) / 1000));
	}

	deleteMessage(queueName: string, receiptHandle: string): void {
		this.requireQueue(queueName);
		this.db
			.delete(messages)
			.where(
				and(
					eq(messages.queueName, queueName),
					eq(messages.receiptHandle, receiptHandle),
				),
			)
			.run();
	}

	purgeQueue(queueName: string): void {
		this.requireQueue(queueName);
		this.db.delete(messages).where(eq(messages.queueName, queueName)).run();
	}

	getQueueAttributes(queueName: string, now = Date.now()): QueueAttributes {
		const queue = this.requireQueue(queueName);
		const visible = this.db
			.select({ n: count() })
			.from(messages)
			.where(
				and(eq(messages.queueName, queueName), lte(messages.visibleAt, now)),
			)
			.get();
		const notVisible = this.db
			.select({ n: count() })
			.from(messages)
			.where(
				and(eq(messages.queueName, queueName), gt(messages.visibleAt, now)),
			)
			.get();

		return {
			approximateNumberOfMessages: visible?.n ?? 0,
			approximateNumberOfMessagesNotVisible: notVisible?.n ?? 0,
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

	private nextCandidates(
		queue: QueueRecord,
		now: number,
		limit: number,
	): MessageRow[] {
		if (!queue.fifo) {
			return this.db
				.select()
				.from(messages)
				.where(
					and(eq(messages.queueName, queue.name), lte(messages.visibleAt, now)),
				)
				.orderBy(asc(messages.id))
				.limit(limit)
				.all();
		}

		const groupHeads = sql`WITH RECURSIVE g(gid) AS (
			SELECT MIN(group_id) FROM messages WHERE queue_name = ${queue.name}
			UNION ALL
			SELECT (
				SELECT MIN(group_id) FROM messages
				WHERE queue_name = ${queue.name} AND group_id > g.gid
			)
			FROM g WHERE g.gid IS NOT NULL
		)
		SELECT (
			SELECT MIN(id) FROM messages
			WHERE queue_name = ${queue.name} AND group_id = g.gid
		) FROM g`;

		return this.db
			.select()
			.from(messages)
			.where(
				and(
					sql`${messages.id} IN (${groupHeads})`,
					lte(messages.visibleAt, now),
				),
			)
			.orderBy(asc(messages.id))
			.limit(limit)
			.all();
	}

	/**
	 * Return everything a dead-letter queue holds to the queue it came from, as
	 * SQS StartMessageMoveTask does. Each message goes to the back of that queue
	 * with a fresh receive count, so it gets the full redelivery budget again and
	 * a FIFO group still sees it after anything sent since.
	 */
	redriveDeadLetters(deadLetterName: string, now = Date.now()): number {
		return this.db.transaction(
			(): number => this.moveDeadLetters(deadLetterName, now),
			IMMEDIATE,
		);
	}

	// The body of a redrive, for a caller already inside a transaction:
	// node:sqlite cannot begin one inside another.
	private moveDeadLetters(deadLetterName: string, now: number): number {
		this.requireQueue(deadLetterName);
		const source = this.listQueues().find(
			(queue) => queue.deadLetterTargetName === deadLetterName,
		);
		if (!source) {
			throw new InvalidParameterValueError(
				`${deadLetterName} is not the dead-letter queue of any queue`,
			);
		}
		const rows = this.db
			.select()
			.from(messages)
			.where(eq(messages.queueName, deadLetterName))
			.orderBy(asc(messages.id))
			.all();
		for (const row of rows) this.moveToQueue(row, source.name, now);
		return rows.length;
	}

	redriveForRelease(release: string, deadLetterNames: string[]): void {
		this.db.transaction((): void => {
			const marker = this.db
				.select({ release: releaseRedrive.release })
				.from(releaseRedrive)
				.where(eq(releaseRedrive.id, 1))
				.get();
			if (marker?.release === release) return;
			const now = Date.now();
			for (const name of deadLetterNames) this.moveDeadLetters(name, now);
			this.db
				.insert(releaseRedrive)
				.values({ id: 1, release })
				.onConflictDoUpdate({ target: releaseRedrive.id, set: { release } })
				.run();
		}, IMMEDIATE);
	}

	private moveToQueue(
		message: MessageRow,
		targetName: string,
		now: number,
	): void {
		this.db.delete(messages).where(eq(messages.id, message.id)).run();
		this.insertMessage({
			messageId: message.messageId,
			queueName: targetName,
			body: message.body,
			md5Body: message.md5Body,
			groupId: message.groupId,
			dedupId: message.dedupId,
			sequenceNumber: message.sequenceNumber,
			sentAt: now,
		});
	}

	private pruneDedup(queueName: string, now: number): void {
		this.db
			.delete(dedup)
			.where(
				and(
					eq(dedup.queueName, queueName),
					lt(dedup.createdAt, now - DEDUP_WINDOW_MS),
				),
			)
			.run();
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
