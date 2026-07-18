import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Db } from "../db.js";
import {
	type MessageDataSchema,
	messageDataSchema,
	outboxTable,
} from "../schema/message-data.js";
import { createSqliteTestDb, type SqliteTestDb } from "../test-db-sqlite.js";
import { runInTransaction, serializeSqliteWrites } from "../tx.js";

// The RFC 036 D3 hard requirement: every write on the shared better-sqlite3
// connection routes through the wave-1 serialization, so a plain single
// statement can never land inside another unit's open SAVEPOINT (the
// uncommitted-read / rollback hazard named on PR #1310). The db handle repos
// hold is `serializeSqliteWrites(db)` — unserialized access is impossible by
// construction. The `outbox` table stands in for any write target here (few
// required columns, already dialect-cast for the repos).

const row = (id: string) => ({
	id,
	messageId: `msg-${id}`,
	event: "message.body_synced",
	payload: { messageId: `msg-${id}` },
	createdAt: new Date(),
});

const nextTick = (): Promise<void> =>
	new Promise((resolve) => setImmediate(resolve));

describe("serialized SQLite writes (RFC 036 D3)", () => {
	let raw: SqliteTestDb<MessageDataSchema>;
	let db: Db<MessageDataSchema>;
	let close: () => Promise<void>;

	before(async () => {
		({ db: raw, close } =
			await createSqliteTestDb<MessageDataSchema>(messageDataSchema));
		db = serializeSqliteWrites(raw);
	});

	after(async () => {
		await close();
	});

	const byId = (id: string) =>
		raw.select().from(outboxTable).where(eq(outboxTable.id, id));

	test("a single-statement write does not interleave into an open transaction", async () => {
		const order: string[] = [];
		let release: () => void = () => {};
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});

		// A top-level transaction: insert TX_ROW, park on a barrier (yielding the
		// event loop with the SAVEPOINT open), then throw so the whole unit rolls
		// back.
		const txDone = runInTransaction(db, async (tx) => {
			await tx.insert(outboxTable).values(row("tx-row"));
			order.push("tx-insert");
			await barrier;
			order.push("tx-throw");
			throw new Error("rollback");
		}).catch(() => {
			order.push("tx-rolledback");
		});

		// Let the transaction reach the barrier before the single write is issued.
		await nextTick();
		await nextTick();

		const singleWrite = db
			.insert(outboxTable)
			.values(row("single-row"))
			.then(() => {
				order.push("single-committed");
			});

		// While the transaction holds the write queue, the single write must not
		// have executed — it is queued behind the open unit, not interleaved into
		// its savepoint.
		await nextTick();
		await nextTick();
		assert.equal(
			order.includes("single-committed"),
			false,
			"single write ran while a top-level transaction was open",
		);

		release();
		await txDone;
		await singleWrite;

		assert.deepEqual(order, [
			"tx-insert",
			"tx-throw",
			"tx-rolledback",
			"single-committed",
		]);

		// The transaction rolled back; the single write committed independently —
		// it was never part of the rolled-back savepoint.
		assert.equal(
			(await byId("tx-row")).length,
			0,
			"transaction must roll back",
		);
		assert.equal(
			(await byId("single-row")).length,
			1,
			"single write must commit, not be swallowed by the rolled-back transaction",
		);
	});

	test("concurrent single-statement writes all commit", async () => {
		const ids = Array.from({ length: 20 }, (_, i) => `w-${i}`);
		await Promise.all(ids.map((id) => db.insert(outboxTable).values(row(id))));
		for (const id of ids) {
			assert.equal((await byId(id)).length, 1, `${id} must be committed`);
		}
	});

	test("the explicit .run() executor is also serialized, not just await", async () => {
		// A write executed via `.run()` (not `await`) must still go through the
		// queue — the hardened wrapper intercepts every terminal executor.
		const builder = db
			.insert(outboxTable)
			.values(row("run-row")) as unknown as {
			run: () => Promise<unknown>;
		};
		await builder.run();
		assert.equal((await byId("run-row")).length, 1, "run() committed the row");
	});

	test("the .values() executor is serialized, not run inline", async () => {
		// `values` doubles as the insert chain method and (on a runnable with
		// `.returning()`) a terminal executor. The executor form must queue like
		// every other terminal — issued while a transaction is parked, it must
		// wait for the unit to finish instead of interleaving into its savepoint.
		const order: string[] = [];
		let release: () => void = () => {};
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});

		const txDone = runInTransaction(db, async (tx) => {
			await tx.insert(outboxTable).values(row("values-tx-row"));
			order.push("tx-insert");
			await barrier;
		});

		await nextTick();
		await nextTick();

		const runnable = db
			.insert(outboxTable)
			.values(row("values-row"))
			.returning() as unknown as { values: () => Promise<unknown[]> };
		const executorWrite = runnable.values().then(() => {
			order.push("values-committed");
		});

		await nextTick();
		await nextTick();
		assert.equal(
			order.includes("values-committed"),
			false,
			".values() executor ran while a top-level transaction was open",
		);

		release();
		await txDone;
		await executorWrite;
		assert.deepEqual(order, ["tx-insert", "values-committed"]);
		assert.equal((await byId("values-row")).length, 1);
	});

	test("writes inside a transaction still commit atomically", async () => {
		await runInTransaction(db, async (tx) => {
			await tx.insert(outboxTable).values(row("a"));
			await tx
				.update(outboxTable)
				.set({ event: "message.moved" })
				.where(eq(outboxTable.id, "a"));
		});
		const [committed] = await byId("a");
		assert.equal(committed?.event, "message.moved");

		await assert.rejects(() =>
			runInTransaction(db, async (tx) => {
				await tx.insert(outboxTable).values(row("b"));
				throw new Error("boom");
			}),
		);
		assert.equal((await byId("b")).length, 0, "transaction rollback drops b");
	});
});
