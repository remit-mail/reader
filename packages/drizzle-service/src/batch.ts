import type { BatchItem, BatchResponse } from "drizzle-orm/batch";

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

export type TransactionRunner = (work: () => unknown[]) => unknown[];

export const syncBatch =
	(run: TransactionRunner): WriteBatch =>
	async (items) => {
		if (items.length === 0) return emptyResponse();
		const results = run(() => items.map(runSync));
		return results as unknown as BatchResponse<typeof items>;
	};

export const asyncBatch =
	(db: BatchingDatabase): WriteBatch =>
	async (items) => {
		if (!isNonEmpty(items)) return emptyResponse();
		return db.batch(items);
	};
