import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { OutboxRelay } from "@remit/remit-outbox-relay";
import Database from "better-sqlite3";
import { SqliteOutboxStore } from "./sqlite-outbox-drain.js";

// The SQLite half of the outbox drain (RFC 036 D2): the raw row access against
// the shared file. The relay/enqueue logic on top of it is the shared
// OutboxRelay, already covered in remit-outbox-relay; here a real SQLite outbox
// table proves the SQL — read undrained rows, mark exactly the drained ids.

const makeOutboxDb = () => {
	const db = new Database(":memory:");
	db.exec(`CREATE TABLE outbox (
		id TEXT PRIMARY KEY,
		message_id TEXT NOT NULL,
		event TEXT NOT NULL,
		payload TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		processed_at INTEGER
	)`);
	return db;
};

const insertRow = (
	db: Database.Database,
	id: string,
	messageId: string,
	event: string,
) =>
	db
		.prepare(
			`INSERT INTO outbox (id, message_id, event, payload, created_at)
			 VALUES (?, ?, ?, ?, ?)`,
		)
		.run(id, messageId, event, JSON.stringify({ messageId }), Date.now());

const fakeSqs = (sent: string[]) =>
	({
		send: async (cmd: SendMessageCommand) => {
			sent.push(String(cmd.input.MessageBody));
			return {};
		},
	}) as unknown as ConstructorParameters<typeof OutboxRelay>[0]["sqs"];

describe("SqliteOutboxStore", () => {
	test("drains unprocessed rows and marks them processed", async () => {
		const db = makeOutboxDb();
		insertRow(db, "r1", "m1", "message.body_synced");
		insertRow(db, "r2", "m2", "message.moved");
		insertRow(db, "r3", "m3", "message.removed");

		const sent: string[] = [];
		const relay = new OutboxRelay({
			store: new SqliteOutboxStore(db as unknown as never),
			sqs: fakeSqs(sent),
			queueUrl: "q",
		});

		const count = await relay.drainPending();
		assert.equal(count, 3);
		assert.equal(sent.length, 3);

		const stillPending = db
			.prepare("SELECT count(*) AS n FROM outbox WHERE processed_at IS NULL")
			.get() as { n: number };
		assert.equal(stillPending.n, 0, "every relayed row is marked processed");

		// A second pass has nothing left to do.
		assert.equal(await relay.drainPending(), 0);
		db.close();
	});

	test("a row appended after the id capture is not swallowed", async () => {
		const db = makeOutboxDb();
		insertRow(db, "r1", "m1", "message.body_synced");
		const store = new SqliteOutboxStore(db as unknown as never);

		// Capture the pending ids for m1 (mirrors the relay's pre-send capture),
		// then a second row for the same message+event lands before marking.
		const captured = await store.listPendingRowIds("m1", "message.body_synced");
		insertRow(db, "r2", "m1", "message.body_synced");
		await store.markRowsProcessed(captured);

		const pending = await store.listPendingRowIds("m1", "message.body_synced");
		assert.deepEqual(pending, ["r2"], "the mid-flight row stays pending");
		db.close();
	});
});
