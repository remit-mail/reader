import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import type { Db } from "./db.js";

export type SqliteBatchItem = BatchItem<"sqlite">;

interface SyncPreparable {
	_prepare(): { execute(): { sync(): unknown } };
}

const isSyncPreparable = (value: unknown): value is SyncPreparable =>
	typeof value === "object" &&
	value !== null &&
	typeof Reflect.get(value, "_prepare") === "function";

const runSync = (item: SqliteBatchItem): unknown => {
	if (!isSyncPreparable(item)) {
		throw new TypeError("batch item is not a drizzle sqlite query");
	}
	return item._prepare().execute().sync();
};

/**
 * The shape of D1's `batch()`: every statement commits together or not at all,
 * and none of them reads another's result mid-flight. A write that needs a
 * value reads it before the batch and is written so a stale read loses safely
 * (a conditional `WHERE`, an upsert, a deterministic id).
 *
 * On better-sqlite3 the batch is one synchronous IMMEDIATE transaction: it
 * never yields the event loop, so no other write on the shared connection lands
 * inside it, and IMMEDIATE takes the file's write lock before the first
 * statement so a writer in another process waits out the busy timeout. On a
 * Durable Object's `durable-sqlite` handle it is one `transactionSync`.
 */
export const runBatch = async <
	TSchema extends Record<string, unknown>,
	T extends readonly SqliteBatchItem[],
>(
	db: Db<TSchema>,
	items: T,
): Promise<BatchResponse<T>> => {
	if (items.length === 0) return [] as unknown as BatchResponse<T>;
	const results = db.transaction(() => items.map(runSync), {
		behavior: "immediate",
	});
	return results as unknown as BatchResponse<T>;
};
