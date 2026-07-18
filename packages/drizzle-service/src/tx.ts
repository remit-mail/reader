import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import type { Db } from "./db.js";
import { isSqlite } from "./dialect.js";

// Runs a write set in one transaction, on either dialect (RFC 036 D1).
//
// Postgres uses drizzle's own `db.transaction()`. better-sqlite3 cannot: its
// native transaction runner rejects a callback that returns a promise, and the
// repos' write sets are async. SQLite instead brackets the callback with a
// SAVEPOINT — a savepoint opens a transaction when none is active and commits
// when the outermost one is released.
//
// All writers on this backend share one better-sqlite3 connection (RFC 036 D3),
// and every query runs synchronously, but an async callback still yields the
// event loop at each `await`. Two concurrent top-level transactions would
// therefore interleave their SAVEPOINT/RELEASE on the shared connection and
// corrupt each other's boundaries — and the existing callers do run concurrently
// (message-sync's `unitOfWork.transaction` under pMap). So top-level sqlite
// transactions are serialized behind an async queue: one runs start-to-finish
// before the next begins, which is exactly the global write serialization D3
// accepts at single-box scale. Nested calls (a repo opening its own transaction
// while a unit-of-work already holds one) are detected via AsyncLocalStorage and
// take a nested savepoint on the same open transaction instead of re-queuing,
// which would deadlock.

const inSqliteTx = new AsyncLocalStorage<true>();

let sqliteQueue: Promise<unknown> = Promise.resolve();

function serializeSqlite<T>(task: () => Promise<T>): Promise<T> {
	const result = sqliteQueue.then(task, task);
	// Keep the queue alive regardless of this task's outcome.
	sqliteQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

async function runSqliteSavepoint<TSchema extends Record<string, unknown>, T>(
	db: Db<TSchema>,
	fn: (tx: Db<TSchema>) => Promise<T>,
): Promise<T> {
	const runner = db as unknown as { run: (query: SQL) => unknown };
	const name = `sp_${randomUUID().replace(/-/g, "")}`;
	runner.run(sql.raw(`SAVEPOINT ${name}`));
	try {
		const result = await fn(db);
		runner.run(sql.raw(`RELEASE SAVEPOINT ${name}`));
		return result;
	} catch (error) {
		try {
			runner.run(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`));
			runner.run(sql.raw(`RELEASE SAVEPOINT ${name}`));
		} catch {
			// A failed rollback must not mask the error that caused it; surface
			// the original below.
		}
		throw error;
	}
}

export async function runInTransaction<
	TSchema extends Record<string, unknown>,
	T,
>(db: Db<TSchema>, fn: (tx: Db<TSchema>) => Promise<T>): Promise<T> {
	if (!isSqlite()) {
		return db.transaction(fn);
	}

	if (inSqliteTx.getStore()) {
		// Already inside a top-level transaction on this connection — nest with a
		// savepoint, do not re-queue.
		return runSqliteSavepoint(db, fn);
	}

	return serializeSqlite(() =>
		inSqliteTx.run(true, () => runSqliteSavepoint(db, fn)),
	);
}

// Every write on the shared better-sqlite3 connection must run start-to-finish
// with the connection in autocommit — never during the `await` gap of a
// top-level `runInTransaction` unit, where a plain single statement would join
// the open SAVEPOINT and be lost on its rollback (the uncommitted-read /
// rollback hazard from RFC 036 D3, named on PR #1310). A single statement runs
// synchronously, so the hazard only exists when it lands inside another unit's
// open savepoint; routing it through the same async queue that serializes
// transactions guarantees no savepoint is open when it executes.
//
// Inside a top-level unit (ALS flag set), the savepoint already holds the queue
// slot — running directly is correct and re-queuing would deadlock.
function runSqliteWrite<T>(execute: () => T | Promise<T>): Promise<T> {
	if (inSqliteTx.getStore()) return Promise.resolve(execute());
	return serializeSqlite(async () => execute());
}

const SQLITE_WRITE_METHODS = new Set(["insert", "update", "delete"]);

// The methods that actually run a drizzle write builder's query. Every one of
// them must run under the write queue, not just the `await` (`then`) path — a
// repo (now or later) could execute a write via any of these and must not
// bypass serialization. `values` is an executor only on a runnable (a builder
// with `execute` — including a `.prepare()`d query); on the pre-`.values(rows)`
// insert builder it is the chain method, which the runnable gate below leaves
// to the pass-through path.
const SQLITE_EXECUTORS = new Set(["execute", "run", "all", "get", "values"]);

// A drizzle write builder is identified by its `execute` method. A Promise (what
// the executors above return) has `then` but no `execute`, so it is never
// mistaken for a builder and re-wrapped — re-wrapping a Promise would make its
// intercepted `then` call the non-existent `promise.execute()`.
const isWriteBuilder = (value: unknown): value is { execute: () => unknown } =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { execute?: unknown }).execute === "function";

const runBuilder = (builder: object): Promise<unknown> =>
	runSqliteWrite(() => (builder as { execute: () => unknown }).execute());

// Wrap a drizzle insert/update/delete builder so every terminal — the `await`
// (`then`/`catch`/`finally`) and the explicit executors (`execute`/`run`/`all`/
// `get`/`values`) — runs the query through `runSqliteWrite` instead of inline.
// Terminals exist only on a runnable (`execute` present), so interception is
// gated on that: on a pre-`.values(rows)` insert builder nothing is
// intercepted and the chain passes through untouched. The chain
// methods (`.values().returning().onConflictDoUpdate()`, `.set()`, `.where()`)
// return builders, so each chained result is re-wrapped until a terminal fires.
// Reads never reach here — only the write entry points below.
function wrapWriteBuilder<B extends object>(builder: B): B {
	return new Proxy(builder, {
		get(target, prop, receiver) {
			if (isWriteBuilder(target)) {
				if (prop === "then") {
					return (
						onFulfilled?: ((value: unknown) => unknown) | null,
						onRejected?: ((reason: unknown) => unknown) | null,
					) => runBuilder(target).then(onFulfilled, onRejected);
				}
				if (prop === "catch") {
					return (onRejected?: ((reason: unknown) => unknown) | null) =>
						runBuilder(target).catch(onRejected);
				}
				if (prop === "finally") {
					return (onFinally?: (() => void) | null) =>
						runBuilder(target).finally(onFinally);
				}
			}
			if (
				typeof prop === "string" &&
				SQLITE_EXECUTORS.has(prop) &&
				isWriteBuilder(target)
			) {
				return (...args: unknown[]) =>
					runSqliteWrite(() =>
						(target as unknown as Record<string, (...a: unknown[]) => unknown>)[
							prop
						](...args),
					);
			}
			const value = Reflect.get(target, prop, receiver);
			if (typeof value === "function") {
				return (...args: unknown[]) => {
					const result = (value as (...a: unknown[]) => unknown).apply(
						target,
						args,
					);
					return result === target || isWriteBuilder(result)
						? wrapWriteBuilder(result as object)
						: result;
				};
			}
			return value;
		},
	});
}

// Route every repo write through the write queue (RFC 036 D3). The handle a repo
// holds intercepts `insert`/`update`/`delete` and serializes the resulting
// query, so no repo insert/update/delete can land inside another unit's open
// SAVEPOINT. Deliberate escape hatches pass straight through: `run` (the
// savepoint DDL, already inside a serialized unit), `transaction`, and reads —
// reads are not serialized, so a read issued during another unit's open
// transaction can still observe uncommitted rows; the wrapper closes the
// write-side rollback hazard, not read isolation. On Postgres this is never
// applied.
export function serializeSqliteWrites<TDb extends Db<Record<string, unknown>>>(
	db: TDb,
): TDb {
	return new Proxy(db, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (
				typeof prop === "string" &&
				SQLITE_WRITE_METHODS.has(prop) &&
				typeof value === "function"
			) {
				return (...args: unknown[]) =>
					wrapWriteBuilder(
						(value as (...a: unknown[]) => object).apply(target, args),
					);
			}
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as TDb;
}
