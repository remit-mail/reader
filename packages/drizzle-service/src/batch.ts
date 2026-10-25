import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import type { Db } from "./db.js";

export type SqliteBatchItem = BatchItem<"sqlite">;

/**
 * The one write port a repository is handed for a write set, bound to one
 * database. It has the shape of D1's `batch()`: every statement commits
 * together or not at all, and none of them reads another's result mid-flight.
 * A write that needs a value reads it before the batch and is written so a
 * stale read loses safely (a conditional `WHERE`, an upsert, a deterministic
 * id).
 */
export type WriteBatch = <T extends readonly SqliteBatchItem[]>(
	items: T,
) => Promise<BatchResponse<T>>;

type NonEmptyBatch = readonly [SqliteBatchItem, ...SqliteBatchItem[]];

/** A driver with drizzle's native `batch()`: D1 and libsql. */
export interface BatchingDatabase {
	batch<U extends SqliteBatchItem, T extends Readonly<[U, ...U[]]>>(
		batch: T,
	): Promise<BatchResponse<T>>;
}

interface SyncPreparable {
	_prepare(): { execute(): { sync(): unknown } };
}

const isSyncPreparable = (value: unknown): value is SyncPreparable =>
	typeof value === "object" &&
	value !== null &&
	typeof Reflect.get(value, "_prepare") === "function";

const isNonEmpty = <T extends readonly SqliteBatchItem[]>(
	items: T,
): items is T & NonEmptyBatch => items.length > 0;

const runSync = (item: SqliteBatchItem): unknown => {
	if (!isSyncPreparable(item)) {
		throw new TypeError("batch item is not a drizzle sqlite query");
	}
	return item._prepare().execute().sync();
};

const emptyResponse = <
	T extends readonly SqliteBatchItem[],
>(): BatchResponse<T> => [] as unknown as BatchResponse<T>;

/**
 * A batch as one synchronous transaction. On better-sqlite3 it is IMMEDIATE:
 * it never yields the event loop, so no other write on the shared connection
 * lands inside it, and it takes the file's write lock before the first
 * statement so a writer in another process waits out the busy timeout. On a
 * Durable Object's `durable-sqlite` handle it is one `transactionSync`.
 */
export const syncBatch =
	<TSchema extends Record<string, unknown>>(db: Db<TSchema>): WriteBatch =>
	async (items) => {
		if (items.length === 0) return emptyResponse();
		const results = db.transaction(() => items.map(runSync), {
			behavior: "immediate",
		});
		return results as unknown as BatchResponse<typeof items>;
	};

/** A batch as the driver's own `batch()`, for D1 and libsql. */
export const asyncBatch =
	(db: BatchingDatabase): WriteBatch =>
	async (items) => {
		if (!isNonEmpty(items)) return emptyResponse();
		return db.batch(items);
	};
