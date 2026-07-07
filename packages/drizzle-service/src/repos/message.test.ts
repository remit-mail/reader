import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	envelopeId as deriveEnvelopeId,
	rootBodyPartId as deriveRootBodyPartId,
} from "../id.js";
import { DrizzleEnvelopeRepository } from "./envelope.js";
import { DrizzleMessageRepository } from "./message.js";
import { createTestDb, type TestDb } from "./test-helpers.js";

describe("DrizzleMessageRepository", () => {
	let db: TestDb;
	let stop: () => Promise<void>;
	let messageRepo: DrizzleMessageRepository;
	let envelopeRepo: DrizzleEnvelopeRepository;

	const MESSAGE_ID = "00000000-0000-0000-1111-000000000001";
	const MAILBOX_ID = "00000000-0000-0000-1111-000000000002";
	const ENVELOPE_ID = deriveEnvelopeId(MESSAGE_ID);
	const ROOT_BODY_PART_ID = deriveRootBodyPartId(MESSAGE_ID);
	const NOW = 1700000000000;

	const BASE_MESSAGE_INPUT = {
		messageId: MESSAGE_ID,
		mailboxId: MAILBOX_ID,
		uid: 42,
		sequenceNumber: 1,
		rfc822Size: 1024,
		internalDate: NOW,
		messageIdHeader: "<test@example.com>",
		envelopeId: ENVELOPE_ID,
		rootBodyPartId: ROOT_BODY_PART_ID,
		status: "active" as const,
		syncStatus: "synced" as const,
	};

	before(async () => {
		({ db, stop } = await createTestDb());
		messageRepo = new DrizzleMessageRepository(db);
		envelopeRepo = new DrizzleEnvelopeRepository(db);
	});

	after(async () => {
		await stop();
	});

	describe("create — writes message + outbox row in one transaction", () => {
		test("creates a message and returns MessageItem", async () => {
			const item = await messageRepo.create(BASE_MESSAGE_INPUT);
			assert.equal(item.messageId, MESSAGE_ID);
			assert.equal(item.mailboxId, MAILBOX_ID);
			assert.equal(item.uid, 42);
			assert.equal(item.status, "active");
			assert.equal(item.syncStatus, "synced");
			assert.ok(typeof item.createdAt === "number");
			assert.ok(typeof item.updatedAt === "number");
		});

		test("writes an outbox row in the same transaction", async () => {
			const { outboxTable } = await import("../schema/message-data.js");
			const { eq } = await import("drizzle-orm");
			const rows = await db
				.select()
				.from(outboxTable)
				.where(eq(outboxTable.messageId, MESSAGE_ID));
			assert.ok(rows.length >= 1, "should have at least 1 outbox row");
			assert.equal(rows[0].event, "message.created");
			assert.deepStrictEqual(rows[0].payload, { messageId: MESSAGE_ID });
		});

		test("duplicate messageId throws CreateFailedConflictError and writes no extra outbox row", async () => {
			const { outboxTable } = await import("../schema/message-data.js");
			const { eq } = await import("drizzle-orm");

			const before = await db
				.select()
				.from(outboxTable)
				.where(eq(outboxTable.messageId, MESSAGE_ID));

			await assert.rejects(
				() => messageRepo.create(BASE_MESSAGE_INPUT),
				(err: Error) => {
					assert.equal(err.name, "CreateFailedConflictError");
					return true;
				},
			);

			const after = await db
				.select()
				.from(outboxTable)
				.where(eq(outboxTable.messageId, MESSAGE_ID));
			assert.equal(
				after.length,
				before.length,
				"rolled-back create must not add an outbox row",
			);
		});
	});

	describe("upsert — idempotent re-create", () => {
		test("second upsert returns the same message (no duplicate)", async () => {
			const item = await messageRepo.upsert(BASE_MESSAGE_INPUT);
			assert.equal(item.messageId, MESSAGE_ID);
		});

		test("upsertWithStatus reports created=false for existing row", async () => {
			const result = await messageRepo.upsertWithStatus(BASE_MESSAGE_INPUT);
			assert.equal(result.created, false);
			assert.equal(result.item.messageId, MESSAGE_ID);
		});
	});

	describe("describe — MessageDescription shape (10 members)", () => {
		before(async () => {
			await envelopeRepo.upsertEnvelope({
				envelopeId: ENVELOPE_ID,
				messageId: MESSAGE_ID,
				dateValue: NOW,
				dateRaw: "Mon, 14 Nov 2023 08:00:00 +0000",
				subject: "Test Subject",
			});
		});

		test("returns all 10 MessageDescription members", async () => {
			const desc = await messageRepo.describe(MESSAGE_ID);
			const keys = Object.keys(desc).sort();
			assert.deepStrictEqual(keys, [
				"bodyPart",
				"bodyPartContent",
				"bodyPartParameter",
				"bodyPartStorage",
				"envelope",
				"envelopeAddress",
				"message",
				"messageFlag",
				"messageReference",
				"rawMessageStorage",
			]);
		});

		test("message array has 1 row with correct fields", async () => {
			const desc = await messageRepo.describe(MESSAGE_ID);
			assert.equal(desc.message.length, 1);
			const msg = desc.message[0];
			assert.equal(msg.messageId, MESSAGE_ID);
			assert.equal(msg.mailboxId, MAILBOX_ID);
			assert.equal(msg.uid, 42);
		});

		test("envelope array has 1 row", async () => {
			const desc = await messageRepo.describe(MESSAGE_ID);
			assert.equal(desc.envelope.length, 1);
			assert.equal(desc.envelope[0].envelopeId, ENVELOPE_ID);
		});

		test("other arrays are empty (no related data inserted)", async () => {
			const desc = await messageRepo.describe(MESSAGE_ID);
			assert.equal(desc.messageFlag.length, 0);
			assert.equal(desc.messageReference.length, 0);
			assert.equal(desc.envelopeAddress.length, 0);
			assert.equal(desc.bodyPart.length, 0);
			assert.equal(desc.bodyPartParameter.length, 0);
			assert.equal(desc.rawMessageStorage.length, 0);
			assert.equal(desc.bodyPartStorage.length, 0);
			assert.equal(desc.bodyPartContent.length, 0);
		});

		test("throws NotFoundError for unknown messageId", async () => {
			await assert.rejects(
				() => messageRepo.describe("00000000-0000-0000-9999-000000000000"),
				(err: Error) => {
					assert.equal(err.name, "NotFoundError");
					return true;
				},
			);
		});
	});

	describe("updateForMove — relocates a message across mailboxes", () => {
		const MOVE_MESSAGE_ID = "00000000-0000-0000-2222-000000000001";
		const SOURCE_MAILBOX_ID = "00000000-0000-0000-2222-000000000002";
		const DEST_MAILBOX_ID = "00000000-0000-0000-2222-000000000003";

		before(async () => {
			await messageRepo.create({
				messageId: MOVE_MESSAGE_ID,
				mailboxId: SOURCE_MAILBOX_ID,
				uid: 7,
				sequenceNumber: 1,
				rfc822Size: 512,
				internalDate: NOW,
				envelopeId: deriveEnvelopeId(MOVE_MESSAGE_ID),
				rootBodyPartId: deriveRootBodyPartId(MOVE_MESSAGE_ID),
				status: "active" as const,
				syncStatus: "synced" as const,
			});
		});

		test("returns the moved message with new mailbox and pending status", async () => {
			const moved = await messageRepo.updateForMove(MOVE_MESSAGE_ID, {
				mailboxId: DEST_MAILBOX_ID,
				status: "moving",
				syncStatus: "pending",
				originalMailboxId: SOURCE_MAILBOX_ID,
				originalUid: 7,
			});
			assert.equal(moved.mailboxId, DEST_MAILBOX_ID);
			assert.equal(moved.status, "moving");
			assert.equal(moved.syncStatus, "pending");
			assert.equal(moved.originalMailboxId, SOURCE_MAILBOX_ID);
			assert.equal(moved.originalUid, 7);
		});

		test("the relocation is reflected in a subsequent read", async () => {
			const read = await messageRepo.get(MOVE_MESSAGE_ID);
			assert.equal(read.mailboxId, DEST_MAILBOX_ID);
			assert.equal(read.status, "moving");
			assert.equal(read.originalMailboxId, SOURCE_MAILBOX_ID);
		});

		test("listByMailbox excludes the old mailbox and includes the new one", async () => {
			const oldList = await messageRepo.listByMailbox(SOURCE_MAILBOX_ID);
			assert.ok(
				!oldList.items.some((m) => m.messageId === MOVE_MESSAGE_ID),
				"moved message must not appear under the source mailbox",
			);

			const newList = await messageRepo.listByMailbox(DEST_MAILBOX_ID);
			assert.ok(
				newList.items.some((m) => m.messageId === MOVE_MESSAGE_ID),
				"moved message must appear under the destination mailbox",
			);
		});

		test("updateForMove writes no move reindex event (completion-only)", async () => {
			const { outboxTable } = await import("../schema/message-data.js");
			const { and, eq } = await import("drizzle-orm");
			const rows = await db
				.select()
				.from(outboxTable)
				.where(
					and(
						eq(outboxTable.messageId, MOVE_MESSAGE_ID),
						eq(outboxTable.event, "message.moved"),
					),
				);
			assert.equal(rows.length, 0);
		});

		test("updateUid completes the move and emits a move reindex event", async () => {
			const completed = await messageRepo.updateUid(
				MOVE_MESSAGE_ID,
				99,
				DEST_MAILBOX_ID,
			);
			assert.equal(completed.uid, 99);
			assert.equal(completed.mailboxId, DEST_MAILBOX_ID);
			assert.equal(completed.status, "active");
			assert.equal(completed.syncStatus, "synced");

			const read = await messageRepo.get(MOVE_MESSAGE_ID);
			assert.equal(read.uid, 99);
			assert.equal(read.status, "active");
			assert.equal(read.syncStatus, "synced");

			const { outboxTable } = await import("../schema/message-data.js");
			const { and, eq } = await import("drizzle-orm");
			const rows = await db
				.select()
				.from(outboxTable)
				.where(
					and(
						eq(outboxTable.messageId, MOVE_MESSAGE_ID),
						eq(outboxTable.event, "message.moved"),
					),
				);
			assert.equal(rows.length, 1, "one move reindex event was enqueued");
			assert.deepStrictEqual(rows[0].payload, { messageId: MOVE_MESSAGE_ID });
			assert.equal(rows[0].processedAt, null, "event starts undrained");
		});

		test("updateForMove throws NotFoundError for unknown messageId", async () => {
			await assert.rejects(
				() =>
					messageRepo.updateForMove("00000000-0000-0000-9999-000000000001", {
						mailboxId: DEST_MAILBOX_ID,
					}),
				(err: Error) => {
					assert.equal(err.name, "NotFoundError");
					return true;
				},
			);
		});

		test("updateUid throws NotFoundError and rolls back its reindex event", async () => {
			const UNKNOWN = "00000000-0000-0000-9999-000000000002";
			await assert.rejects(
				() => messageRepo.updateUid(UNKNOWN, 1, DEST_MAILBOX_ID),
				(err: Error) => {
					assert.equal(err.name, "NotFoundError");
					return true;
				},
			);

			const { outboxTable } = await import("../schema/message-data.js");
			const { eq } = await import("drizzle-orm");
			const rows = await db
				.select()
				.from(outboxTable)
				.where(eq(outboxTable.messageId, UNKNOWN));
			assert.equal(rows.length, 0, "rolled-back move writes no outbox row");
		});
	});

	describe("update — appends a body_synced outbox row per body write", () => {
		const SYNC_MESSAGE_ID = "00000000-0000-0000-3333-000000000001";
		const SYNC_MAILBOX_ID = "00000000-0000-0000-3333-000000000002";

		const bodySyncedRows = async () => {
			const { outboxTable } = await import("../schema/message-data.js");
			const { and, eq } = await import("drizzle-orm");
			return db
				.select()
				.from(outboxTable)
				.where(
					and(
						eq(outboxTable.messageId, SYNC_MESSAGE_ID),
						eq(outboxTable.event, "message.body_synced"),
					),
				);
		};

		before(async () => {
			await messageRepo.create({
				messageId: SYNC_MESSAGE_ID,
				mailboxId: SYNC_MAILBOX_ID,
				uid: 11,
				sequenceNumber: 1,
				rfc822Size: 256,
				internalDate: NOW,
				envelopeId: deriveEnvelopeId(SYNC_MESSAGE_ID),
				rootBodyPartId: deriveRootBodyPartId(SYNC_MESSAGE_ID),
				status: "active" as const,
				syncStatus: "synced" as const,
			});
		});

		test("a body write appends one body_synced event", async () => {
			assert.equal((await bodySyncedRows()).length, 0, "none before sync");
			await messageRepo.update(SYNC_MESSAGE_ID, {
				bodyStorageKey: "s3://bucket/body-a.eml",
			});
			const rows = await bodySyncedRows();
			assert.equal(rows.length, 1, "one row for one body write");
			assert.deepStrictEqual(rows[0].payload, { messageId: SYNC_MESSAGE_ID });
			assert.equal(rows[0].processedAt, null, "event starts undrained");
		});

		test("each body write appends its own row (append-only, no suppression)", async () => {
			await messageRepo.update(SYNC_MESSAGE_ID, {
				bodyStorageKey: "s3://bucket/body-b.eml",
			});
			await messageRepo.update(SYNC_MESSAGE_ID, {
				bodyStorageKey: "s3://bucket/body-c.eml",
			});
			assert.equal(
				(await bodySyncedRows()).length,
				3,
				"three body writes leave three rows — coalescing is the worker's job",
			);
		});

		test("a classification-only update (no bodyStorageKey) appends nothing", async () => {
			const before = (await bodySyncedRows()).length;
			await messageRepo.update(SYNC_MESSAGE_ID, { category: "personal" });
			assert.equal((await bodySyncedRows()).length, before);
		});
	});

	describe("deleteMany — subtree delete + message.removed outbox", () => {
		const DEL_MESSAGE_ID = "00000000-0000-0000-4444-000000000001";
		const DEL_MAILBOX_ID = "00000000-0000-0000-4444-000000000002";
		const DEL_ENVELOPE_ID = deriveEnvelopeId(DEL_MESSAGE_ID);
		const DEL_ROOT_BODY_PART_ID = deriveRootBodyPartId(DEL_MESSAGE_ID);
		const FLAG_ID = "00000000-0000-0000-4444-000000000003";
		const BODY_PART_ID = "00000000-0000-0000-4444-000000000004";

		before(async () => {
			await messageRepo.create({
				messageId: DEL_MESSAGE_ID,
				mailboxId: DEL_MAILBOX_ID,
				uid: 7,
				sequenceNumber: 1,
				rfc822Size: 10,
				internalDate: NOW,
				envelopeId: DEL_ENVELOPE_ID,
				rootBodyPartId: DEL_ROOT_BODY_PART_ID,
				status: "active",
				syncStatus: "synced",
			});
			await envelopeRepo.upsertEnvelope({
				envelopeId: DEL_ENVELOPE_ID,
				messageId: DEL_MESSAGE_ID,
				dateValue: NOW,
				dateRaw: "Mon, 14 Nov 2023 08:00:00 +0000",
				subject: "To be purged",
			});
			const { messageFlagTable, bodyPartTable } = await import(
				"../schema/message-data.js"
			);
			await db.insert(messageFlagTable).values({
				messageFlagId: FLAG_ID,
				messageId: DEL_MESSAGE_ID,
				flagName: "\\Seen",
				setAt: NOW,
				createdAt: NOW,
				updatedAt: NOW,
			});
			await db.insert(bodyPartTable).values({
				bodyPartId: BODY_PART_ID,
				messageId: DEL_MESSAGE_ID,
				partPath: "1",
				mediaType: "TEXT",
				mediaSubtype: "plain",
				transferEncoding: "7BIT",
				sizeOctets: 4,
				isMultipart: false,
				createdAt: NOW,
				updatedAt: NOW,
			});
		});

		test("removes the message and every child row", async () => {
			await messageRepo.deleteMany([DEL_MESSAGE_ID]);

			await assert.rejects(() => messageRepo.get(DEL_MESSAGE_ID));

			const { messageFlagTable, bodyPartTable, envelopeTable } = await import(
				"../schema/message-data.js"
			);
			const { eq } = await import("drizzle-orm");
			assert.equal(
				(
					await db
						.select()
						.from(messageFlagTable)
						.where(eq(messageFlagTable.messageId, DEL_MESSAGE_ID))
				).length,
				0,
			);
			assert.equal(
				(
					await db
						.select()
						.from(bodyPartTable)
						.where(eq(bodyPartTable.messageId, DEL_MESSAGE_ID))
				).length,
				0,
			);
			assert.equal(
				(
					await db
						.select()
						.from(envelopeTable)
						.where(eq(envelopeTable.messageId, DEL_MESSAGE_ID))
				).length,
				0,
			);
		});

		test("leaves exactly one undrained message.removed outbox row", async () => {
			const { outboxTable } = await import("../schema/message-data.js");
			const { eq } = await import("drizzle-orm");
			const rows = await db
				.select()
				.from(outboxTable)
				.where(eq(outboxTable.messageId, DEL_MESSAGE_ID));
			assert.equal(rows.length, 1, "prior CDC rows are cleared");
			assert.equal(rows[0].event, "message.removed");
			assert.equal(rows[0].processedAt, null, "removal starts undrained");
			assert.deepStrictEqual(rows[0].payload, { messageId: DEL_MESSAGE_ID });
		});

		test("deleteMany([]) is a no-op", async () => {
			await messageRepo.deleteMany([]);
		});
	});
});
