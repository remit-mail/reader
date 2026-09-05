import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import {
	DrizzleMessageRepository,
	OUTBOX_EVENTS,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { OutboxRelay } from "@remit/outbox-relay";
import { SqliteOutboxStore } from "./sqlite-outbox-drain.js";

type SqliteHandle = ReturnType<typeof createShippedSqliteDb>["sqlite"];

// The outbox invariant (reader#1063): every event kind a producer writes has a
// consumer that drains it. `message.created` was written once per message and
// drained by nothing, so a live instance carried 30,906 rows that could never
// clear. This runs the real producers (the message repo) and the real consumer
// (the relay over the SQLite store) against the shipped migrations, so a kind
// with no drain shows up as a row that stays undrained.

const fakeSqs = (sent: string[]) =>
	({
		send: async (cmd: SendMessageCommand) => {
			sent.push(String(cmd.input.MessageBody));
			return {};
		},
	}) as unknown as ConstructorParameters<typeof OutboxRelay>[0]["sqs"];

const drainAll = async (sqlite: SqliteHandle): Promise<void> => {
	const relay = new OutboxRelay({
		store: new SqliteOutboxStore(sqlite as unknown as never),
		sqs: fakeSqs([]),
		queueUrl: "q",
	});
	while ((await relay.drainPending()) > 0) {
		// Drain reads a bounded batch; repeat until the table is quiet.
	}
};

const undrainedEvents = (sqlite: SqliteHandle): string[] =>
	(
		sqlite
			.prepare(
				"SELECT DISTINCT event FROM outbox WHERE processed_at IS NULL ORDER BY event",
			)
			.all() as Array<{ event: string }>
	).map((row) => row.event);

const writtenEvents = (sqlite: SqliteHandle): string[] =>
	(
		sqlite
			.prepare("SELECT DISTINCT event FROM outbox ORDER BY event")
			.all() as Array<{ event: string }>
	).map((row) => row.event);

const NOW = 1700000000000;
const MAILBOX_ID = "00000000-0000-0000-4444-000000000001";
const DEST_MAILBOX_ID = "00000000-0000-0000-4444-000000000002";

const createInput = (messageId: string) => ({
	messageId,
	mailboxId: MAILBOX_ID,
	uid: 1,
	sequenceNumber: 1,
	rfc822Size: 512,
	internalDate: NOW,
	envelopeId: randomUUID(),
	rootBodyPartId: randomUUID(),
});

describe("outbox drain coverage", () => {
	test("every event the message repo writes is drained", async () => {
		const { db, sqlite, close } = createShippedSqliteDb();
		const repo = new DrizzleMessageRepository(
			db as unknown as ConstructorParameters<
				typeof DrizzleMessageRepository
			>[0],
		);

		const bodySyncedId = randomUUID();
		await repo.create(createInput(bodySyncedId));
		await repo.update(bodySyncedId, { bodyStorageKey: "body/1.json" });

		const movedId = randomUUID();
		await repo.create(createInput(movedId));
		await repo.updateUid(movedId, 99, DEST_MAILBOX_ID);

		const removedId = randomUUID();
		await repo.create(createInput(removedId));
		await repo.delete(removedId);

		assert.deepEqual(
			writtenEvents(sqlite),
			[...OUTBOX_EVENTS].sort(),
			"the producers write exactly the declared outbox vocabulary",
		);

		await drainAll(sqlite);

		assert.deepEqual(
			undrainedEvents(sqlite),
			[],
			"a kind left undrained here grows the outbox forever",
		);
		close();
	});

	test("every declared event kind has a consumer that drains it", async () => {
		const { sqlite, close } = createShippedSqliteDb();

		for (const event of OUTBOX_EVENTS) {
			sqlite
				.prepare(
					`INSERT INTO outbox (id, message_id, event, payload, created_at)
					 VALUES (?, ?, ?, ?, ?)`,
				)
				.run(
					randomUUID(),
					`m-${event}`,
					event,
					JSON.stringify({ messageId: `m-${event}` }),
					Date.now(),
				);
		}

		await drainAll(sqlite);

		assert.deepEqual(undrainedEvents(sqlite), []);
		close();
	});
});
