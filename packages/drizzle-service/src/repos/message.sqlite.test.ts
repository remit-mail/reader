import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import {
	envelopeId as deriveEnvelopeId,
	rootBodyPartId as deriveRootBodyPartId,
} from "../id.js";
import {
	type MessageDataSchema,
	messageDataSchema,
	outboxTable,
} from "../schema/message-data.js";
import { createSqliteTestDb, type SqliteTestDb } from "../test-db-sqlite.js";
import { DrizzleMessageRepository } from "./message.js";

// Runs the ported message repo against a real better-sqlite3 database
// (RFC 036 D1). Exercises the SQLite-specific seams: the SAVEPOINT-bracketed
// transaction, the sqlite outbox table (text-json payload), the unique-
// violation → CreateFailedConflictError mapping, and the JSON/boolean columns.

describe("DrizzleMessageRepository (sqlite)", () => {
	let db: SqliteTestDb<MessageDataSchema>;
	let close: () => Promise<void>;
	let repo: DrizzleMessageRepository;

	const MESSAGE_ID = "00000000-0000-0000-2222-000000000001";
	const MAILBOX_ID = "00000000-0000-0000-2222-000000000002";
	const NOW = 1700000000000;

	const BASE_INPUT = {
		messageId: MESSAGE_ID,
		mailboxId: MAILBOX_ID,
		uid: 42,
		sequenceNumber: 1,
		rfc822Size: 1024,
		internalDate: NOW,
		messageIdHeader: "<test@example.com>",
		envelopeId: deriveEnvelopeId(MESSAGE_ID),
		rootBodyPartId: deriveRootBodyPartId(MESSAGE_ID),
		status: "active" as const,
		syncStatus: "synced" as const,
		hasListUnsubscribe: true,
		authenticity: { spf: "pass" } as unknown as never,
	};

	before(async () => {
		({ db, close } = await createSqliteTestDb(messageDataSchema));
		repo = new DrizzleMessageRepository(db);
	});

	after(async () => {
		await close();
	});

	test("create returns a MessageItem and writes one outbox row atomically", async () => {
		const item = await repo.create(BASE_INPUT);
		assert.equal(item.messageId, MESSAGE_ID);
		assert.equal(item.status, "active");
		assert.equal(item.hasListUnsubscribe, true);

		const rows = await db
			.select()
			.from(outboxTable)
			.where(eq(outboxTable.messageId, MESSAGE_ID));
		assert.equal(rows.length, 1);
		assert.equal(rows[0].event, "message.created");
		assert.deepEqual(rows[0].payload, { messageId: MESSAGE_ID });
	});

	test("boolean and json columns round-trip", async () => {
		const item = await repo.get(MESSAGE_ID);
		assert.equal(item.hasListUnsubscribe, true);
		assert.equal(item.movedByRemit, false);
		assert.deepEqual(item.authenticity, { spf: "pass" });
	});

	test("filterMove and placementVerdict JSONB columns round-trip through create and update", async () => {
		// The auto-moved badge for a standing-filter move depends on this
		// round-trip: body-sync writes `filterMove`, and both read paths project it
		// back through `toMessageItem` for `deriveAutoMoved` (issue #223).
		const AUTO_MOVED_ID = "00000000-0000-0000-2222-000000000003";
		const filterMove = {
			filterId: "00000000-0000-0000-2222-0000000000f1",
			sourceMailboxId: "00000000-0000-0000-2222-0000000000f2",
			destinationMailboxId: "00000000-0000-0000-2222-0000000000f3",
			decidedAt: NOW,
		};

		const created = await repo.create({
			...BASE_INPUT,
			messageId: AUTO_MOVED_ID,
			envelopeId: deriveEnvelopeId(AUTO_MOVED_ID),
			rootBodyPartId: deriveRootBodyPartId(AUTO_MOVED_ID),
			movedByRemit: true,
			filterMove: filterMove as unknown as never,
		});
		assert.deepEqual(created.filterMove, filterMove);

		const afterCreate = await repo.get(AUTO_MOVED_ID);
		assert.equal(afterCreate.movedByRemit, true);
		assert.deepEqual(afterCreate.filterMove, filterMove);

		// A later placement update must not disturb the marker, and a new marker
		// must overwrite the old one — the same JSONB-set path body-sync uses.
		const nextFilterMove = { ...filterMove, destinationMailboxId: "mb-other" };
		await repo.update(AUTO_MOVED_ID, {
			filterMove: nextFilterMove as unknown as never,
			placementVerdict: {
				action: "MoveToInbox",
				confidence: "Confident",
				fromPlacement: "junk",
				reasons: ["provider=spam"],
				dryRun: false,
				decidedAt: NOW,
			} as unknown as never,
		});

		const afterUpdate = await repo.get(AUTO_MOVED_ID);
		assert.deepEqual(afterUpdate.filterMove, nextFilterMove);
		assert.equal(afterUpdate.placementVerdict?.action, "MoveToInbox");
	});

	test("duplicate messageId throws CreateFailedConflictError and rolls back the outbox row", async () => {
		const before = await db
			.select()
			.from(outboxTable)
			.where(eq(outboxTable.messageId, MESSAGE_ID));

		await assert.rejects(
			() => repo.create(BASE_INPUT),
			(err: Error) => err.name === "CreateFailedConflictError",
		);

		const afterRows = await db
			.select()
			.from(outboxTable)
			.where(eq(outboxTable.messageId, MESSAGE_ID));
		assert.equal(
			afterRows.length,
			before.length,
			"rolled-back create must not append an outbox row",
		);
	});

	test("upsertWithStatus reports created=false for an existing row", async () => {
		const result = await repo.upsertWithStatus(BASE_INPUT);
		assert.equal(result.created, false);
		assert.equal(result.item.messageId, MESSAGE_ID);
	});

	test("delete removes the message and appends a removal outbox row", async () => {
		await repo.delete(MESSAGE_ID);
		await assert.rejects(() => repo.get(MESSAGE_ID));

		const rows = await db
			.select()
			.from(outboxTable)
			.where(eq(outboxTable.messageId, MESSAGE_ID));
		assert.ok(
			rows.some((r) => r.event === "message.removed"),
			"delete must append a message.removed outbox row",
		);
	});
});
