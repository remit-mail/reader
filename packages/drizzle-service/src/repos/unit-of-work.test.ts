import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import {
	envelopeId as deriveEnvelopeId,
	rootBodyPartId as deriveRootBodyPartId,
} from "../id.js";
import {
	envelopeTable,
	messageTable,
	outboxTable,
} from "../schema/message-data.js";
import { createTestDb, type TestDb } from "./test-helpers.js";
import { DrizzleUnitOfWork } from "./unit-of-work.js";

describe("DrizzleUnitOfWork", () => {
	let db: TestDb;
	let stop: () => Promise<void>;
	let unitOfWork: DrizzleUnitOfWork;

	const MESSAGE_ID = "00000000-0000-0000-2222-000000000001";
	const MAILBOX_ID = "00000000-0000-0000-2222-000000000002";
	const NOW = 1700000000000;

	const writeEnvelopeAndMessage = async (
		repos: Parameters<Parameters<DrizzleUnitOfWork["transaction"]>[0]>[0],
	) => {
		await repos.envelope.upsertEnvelope({
			envelopeId: deriveEnvelopeId(MESSAGE_ID),
			messageId: MESSAGE_ID,
			dateValue: NOW,
			dateRaw: "Tue, 14 Nov 2023 22:13:20 +0000",
			subject: "hello",
			messageIdValue: "<hello@example.com>",
		});
		await repos.message.upsertWithStatus({
			messageId: MESSAGE_ID,
			mailboxId: MAILBOX_ID,
			uid: 7,
			sequenceNumber: 1,
			rfc822Size: 1024,
			internalDate: NOW,
			envelopeId: deriveEnvelopeId(MESSAGE_ID),
			rootBodyPartId: deriveRootBodyPartId(MESSAGE_ID),
		});
	};

	const rows = async () => {
		const envelopes = await db
			.select()
			.from(envelopeTable)
			.where(eq(envelopeTable.messageId, MESSAGE_ID));
		const messages = await db
			.select()
			.from(messageTable)
			.where(eq(messageTable.messageId, MESSAGE_ID));
		const outbox = await db
			.select()
			.from(outboxTable)
			.where(eq(outboxTable.messageId, MESSAGE_ID));
		return { envelopes, messages, outbox };
	};

	before(async () => {
		({ db, stop } = await createTestDb());
		unitOfWork = new DrizzleUnitOfWork(db);
	});

	after(async () => {
		await stop();
	});

	test("a mid-save throw rolls back the whole write set, outbox included", async () => {
		await assert.rejects(
			() =>
				unitOfWork.transaction(async (repos) => {
					await writeEnvelopeAndMessage(repos);
					// A later write in the set fails after the envelope, message and its
					// transactional-outbox row have already been written.
					throw new Error("thread write failed");
				}),
			/thread write failed/,
		);

		const { envelopes, messages, outbox } = await rows();
		assert.equal(envelopes.length, 0, "envelope must be rolled back");
		assert.equal(messages.length, 0, "message must be rolled back");
		assert.equal(
			outbox.length,
			0,
			"outbox row must be rolled back with the message",
		);
	});

	test("a successful transaction commits the data rows and the outbox row", async () => {
		await unitOfWork.transaction(writeEnvelopeAndMessage);

		const { envelopes, messages, outbox } = await rows();
		assert.equal(envelopes.length, 1);
		assert.equal(messages.length, 1);
		assert.equal(outbox.length, 1);
		assert.equal(outbox[0].event, "message.created");
		assert.deepStrictEqual(outbox[0].payload, { messageId: MESSAGE_ID });
	});
});
