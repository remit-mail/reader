import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import {
	envelopeId as deriveEnvelopeId,
	rootBodyPartId as deriveRootBodyPartId,
} from "../id.js";
import { addressTable } from "../schema/i4-address.js";
import {
	type MessageDataSchema,
	messageDataSchema,
	messageTable,
} from "../schema/message-data.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { createSqliteTestDb, type SqliteTestDb } from "../test-db-sqlite.js";
import { DrizzleUnitOfWork } from "./unit-of-work.js";

// The unit-of-work runs its write set inside one SAVEPOINT on sqlite (RFC 036
// D1) — and each repo's own `create` opens a nested SAVEPOINT, so this also
// covers savepoint nesting. Commit persists the whole set; a throw rolls all of
// it back, message and thread-message together.

const SCHEMA = {
	...messageDataSchema,
	threadMessage: threadMessageTable,
	address: addressTable,
};

describe("DrizzleUnitOfWork (sqlite)", () => {
	let db: SqliteTestDb<MessageDataSchema>;
	let close: () => Promise<void>;
	let uow: DrizzleUnitOfWork;

	before(async () => {
		({ db, close } = await createSqliteTestDb<MessageDataSchema>(SCHEMA));
		uow = new DrizzleUnitOfWork(db);
	});

	after(async () => {
		await close();
	});

	const messageInput = (id: string) => ({
		messageId: id,
		mailboxId: "00000000-0000-0000-3333-000000000002",
		uid: 7,
		sequenceNumber: 1,
		rfc822Size: 512,
		internalDate: 1700000000000,
		envelopeId: deriveEnvelopeId(id),
		rootBodyPartId: deriveRootBodyPartId(id),
		status: "active" as const,
		syncStatus: "synced" as const,
	});

	const threadInput = (id: string) => ({
		accountConfigId: "acct-1",
		threadId: `thread-${id}`,
		messageId: id,
		mailboxId: "mbx-1",
		uid: 7,
		referenceOrder: 0,
		internalDate: 1700000000000,
		sentDate: 1700000000000,
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
	});

	test("commits message + thread-message together", async () => {
		const id = "00000000-0000-0000-3333-000000000010";
		await uow.transaction(async (repos) => {
			await repos.message.create(messageInput(id));
			await repos.threadMessage.create(threadInput(id));
		});

		const msg = await db
			.select()
			.from(messageTable)
			.where(eq(messageTable.messageId, id));
		const thread = await db
			.select()
			.from(threadMessageTable)
			.where(eq(threadMessageTable.messageId, id));
		assert.equal(msg.length, 1);
		assert.equal(thread.length, 1);
	});

	test("a throw rolls the whole set back", async () => {
		const id = "00000000-0000-0000-3333-000000000011";
		await assert.rejects(() =>
			uow.transaction(async (repos) => {
				await repos.message.create(messageInput(id));
				await repos.threadMessage.create(threadInput(id));
				throw new Error("boom");
			}),
		);

		const msg = await db
			.select()
			.from(messageTable)
			.where(eq(messageTable.messageId, id));
		const thread = await db
			.select()
			.from(threadMessageTable)
			.where(eq(threadMessageTable.messageId, id));
		assert.equal(msg.length, 0, "message insert must roll back");
		assert.equal(thread.length, 0, "thread-message insert must roll back");
	});

	test("concurrent transactions serialize without corrupting savepoints", async () => {
		const ids = Array.from(
			{ length: 12 },
			(_, i) =>
				`00000000-0000-0000-3333-0000000001${i.toString().padStart(2, "0")}`,
		);

		// The failure this guards: shared-connection savepoint interleaving when
		// callers run under concurrency (message-sync's pMap). All must commit.
		await Promise.all(
			ids.map((id) =>
				uow.transaction(async (repos) => {
					await repos.message.create(messageInput(id));
					await repos.threadMessage.create(threadInput(id));
				}),
			),
		);

		for (const id of ids) {
			const msg = await db
				.select()
				.from(messageTable)
				.where(eq(messageTable.messageId, id));
			assert.equal(msg.length, 1, `message ${id} must be committed`);
		}
	});
});
