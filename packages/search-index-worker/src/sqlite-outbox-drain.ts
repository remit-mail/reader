import type { Logger } from "@remit/logger-lambda";
import {
	createSqsClient,
	DRAIN_EVENTS,
	isForceEvent,
	isRemoveEvent,
	OutboxRelay,
	type OutboxStore,
	type PendingIndexEvent,
} from "@remit/outbox-relay";

// The SQLite outbox wake (RFC 036 D2). SQLite has no cross-process NOTIFY, so
// the durable outbox drain that backstops Postgres becomes the primary
// mechanism here: a 2-second poll inside the search-index-worker — already
// resident, already the queue's consuming side — relays undrained rows onto the
// search-index queue. Against a local file with the outbox's partial index on
// unprocessed rows the query is microseconds, and a file has none of the
// scale-to-zero concern that forbade constant polling on Postgres.
//
// This process opens its own connection for the drain: it issues only single
// UPDATE statements in autocommit (no transactions), so it never opens a
// savepoint and needs no in-process write serialization — cross-process safety
// with the writers is WAL plus busy_timeout, the same as every other writer.

const DRAIN_INTERVAL_MS = 2_000;

// A minimal view of the better-sqlite3 surface used here, so the module carries
// no static type dependency on the native package (imported dynamically to stay
// out of the Lambda bundle).
interface SqliteStatement {
	all(...params: unknown[]): unknown[];
	run(...params: unknown[]): unknown;
}
interface SqliteDatabase {
	pragma(source: string): unknown;
	prepare(sql: string): SqliteStatement;
	close(): void;
}

export class SqliteOutboxStore implements OutboxStore {
	constructor(private readonly db: SqliteDatabase) {}

	async listUnprocessedEvents(): Promise<PendingIndexEvent[]> {
		const placeholders = DRAIN_EVENTS.map(() => "?").join(", ");
		const rows = this.db
			.prepare(
				`SELECT DISTINCT message_id, event FROM outbox
				 WHERE event IN (${placeholders}) AND processed_at IS NULL`,
			)
			.all(...DRAIN_EVENTS) as Array<{ message_id: string; event: string }>;
		return rows.map((row) => ({
			messageId: row.message_id,
			event: row.event,
			force: isForceEvent(row.event),
			remove: isRemoveEvent(row.event),
		}));
	}

	async listPendingRowIds(messageId: string, event: string): Promise<string[]> {
		const rows = this.db
			.prepare(
				`SELECT id FROM outbox
				 WHERE message_id = ? AND event = ? AND processed_at IS NULL`,
			)
			.all(messageId, event) as Array<{ id: string }>;
		return rows.map((row) => row.id);
	}

	async markRowsProcessed(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const placeholders = ids.map(() => "?").join(", ");
		this.db
			.prepare(
				`UPDATE outbox SET processed_at = ?
				 WHERE id IN (${placeholders}) AND processed_at IS NULL`,
			)
			.run(Date.now(), ...ids);
	}
}

export interface RunningDrain {
	stop(): Promise<void>;
}

export interface SqliteOutboxDrainConfig {
	dbPath?: string;
	queueUrl?: string;
	logger: Logger;
	intervalMs?: number;
}

/**
 * Start the SQLite outbox drain: a boot drain to catch anything pending while
 * the worker was down, then a poll every `intervalMs` (default 2 s). Overlapping
 * ticks are skipped so a slow drain never stacks; the timer is unref'd so it
 * never keeps the process alive on its own.
 */
export const startSqliteOutboxDrain = async (
	config: SqliteOutboxDrainConfig,
): Promise<RunningDrain> => {
	const dbPath = config.dbPath ?? process.env.SQLITE_DB_PATH;
	if (!dbPath) throw new Error("SQLITE_DB_PATH is required");
	const queueUrl = config.queueUrl ?? process.env.SQS_QUEUE_URL_SEARCH_INDEX;
	if (!queueUrl) throw new Error("SQS_QUEUE_URL_SEARCH_INDEX is required");
	const log = config.logger;

	const { default: Database } = await import("better-sqlite3");
	const sqlite = new Database(dbPath) as unknown as SqliteDatabase;
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma("synchronous = NORMAL");

	const sqs = createSqsClient(queueUrl);
	const relay = new OutboxRelay({
		store: new SqliteOutboxStore(sqlite),
		sqs,
		queueUrl,
	});

	let draining = false;
	let inFlight: Promise<unknown> = Promise.resolve();
	const drainOnce = (): void => {
		if (draining) return;
		draining = true;
		inFlight = relay
			.drainPending()
			.catch((error: unknown) =>
				log.error("sqlite outbox drain failed", { error: String(error) }),
			)
			.finally(() => {
				draining = false;
			});
	};

	const bootCount = await relay.drainPending();
	log.info("sqlite outbox boot drain enqueued", { count: bootCount });

	const timer = setInterval(drainOnce, config.intervalMs ?? DRAIN_INTERVAL_MS);
	timer.unref();

	return {
		stop: async () => {
			clearInterval(timer);
			await inFlight;
			sqs.destroy();
			sqlite.close();
		},
	};
};

/**
 * Start the drain only on the SQLite backend; a no-op returning `undefined` on
 * every other backend, so the shared poller entrypoint can call it
 * unconditionally.
 */
export const maybeStartSqliteOutboxDrain = async (
	logger: Logger,
): Promise<RunningDrain | undefined> => {
	if (process.env.DATA_BACKEND !== "sqlite") return undefined;
	return startSqliteOutboxDrain({ logger });
};
