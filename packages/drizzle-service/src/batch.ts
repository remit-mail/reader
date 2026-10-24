import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import type { Db } from "./db.js";

export type SqliteBatchItem = BatchItem<"sqlite">;

// The shape of D1's `batch()`: every statement in the list commits together or
// not at all, and none of them can read another's result mid-flight. A write
// that needs a value first reads it before the batch, and is written so that a
// stale read loses safely (a conditional `WHERE`, an upsert, a deterministic id).
export interface BatchPort {
	batch<T extends readonly SqliteBatchItem[]>(
		items: T,
	): Promise<BatchResponse<T>>;
}

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

// better-sqlite3 runs each batch as one synchronous IMMEDIATE transaction. The
// transaction never yields the event loop, so no other write on the shared
// connection can land inside it, and IMMEDIATE takes the file's write lock
// before the first statement so a writer in another process waits out the
// busy timeout instead of failing the snapshot upgrade.
export const betterSqliteBatch = <TSchema extends Record<string, unknown>>(
	db: Db<TSchema>,
): BatchPort => ({
	batch: async <T extends readonly SqliteBatchItem[]>(
		items: T,
	): Promise<BatchResponse<T>> => {
		if (items.length === 0) return [] as unknown as BatchResponse<T>;
		const results = db.transaction(() => items.map(runSync), {
			behavior: "immediate",
		});
		return results as unknown as BatchResponse<T>;
	},
});

export const runBatch = <
	TSchema extends Record<string, unknown>,
	T extends readonly SqliteBatchItem[],
>(
	db: Db<TSchema>,
	items: T,
): Promise<BatchResponse<T>> => betterSqliteBatch(db).batch(items);
