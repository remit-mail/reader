import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	type MessageDataSchema,
	messageDataSchema,
} from "../schema/message-data.js";
import { createSqliteTestDb, type SqliteTestDb } from "../test-db-sqlite.js";
import { DrizzleEnvelopeRepository } from "./envelope.js";

// Envelope repo on sqlite (RFC 036 D1): the onConflictDoUpdate upsert path and
// the transactional body-part upsert both run on better-sqlite3 unchanged.

const MESSAGE_ID = "00000000-0000-0000-4444-000000000001";

describe("DrizzleEnvelopeRepository (sqlite)", () => {
	let db: SqliteTestDb<MessageDataSchema>;
	let close: () => Promise<void>;
	let repo: DrizzleEnvelopeRepository;

	before(async () => {
		({ db, close } = await createSqliteTestDb(messageDataSchema));
		repo = new DrizzleEnvelopeRepository(db);
	});

	after(async () => {
		await close();
	});

	test("upsertEnvelope inserts then updates on conflict", async () => {
		const created = await repo.upsertEnvelope({
			envelopeId: "ignored-derived",
			messageId: MESSAGE_ID,
			dateValue: 1700000000000,
			dateRaw: "Mon, 14 Nov 2023 08:00:00 +0000",
			subject: "First",
		});
		assert.equal(created.subject, "First");

		const updated = await repo.upsertEnvelope({
			envelopeId: "ignored-derived",
			messageId: MESSAGE_ID,
			dateValue: 1700000000000,
			dateRaw: "Mon, 14 Nov 2023 08:00:00 +0000",
			subject: "Second",
		});
		assert.equal(updated.envelopeId, created.envelopeId);
		assert.equal(updated.subject, "Second");
	});

	test("upsertBodyParts writes parts and parameters in one transaction", async () => {
		await repo.upsertBodyParts(MESSAGE_ID, [
			{
				partPath: "1",
				parentPartPath: null,
				mediaType: "TEXT",
				mediaSubtype: "plain",
				transferEncoding: "7BIT",
				sizeOctets: 128,
				isMultipart: false,
				parameters: [{ parameterName: "charset", parameterValue: "utf-8" }],
			},
		]);

		const data = await repo.getMessageData(MESSAGE_ID);
		assert.ok(data.bodyPart.length >= 1);
		assert.ok(
			data.bodyPartParameter.some(
				(p) => p.parameterName === "charset" && p.parameterValue === "utf-8",
			),
		);
	});

	test("re-upserting the same partPath does not duplicate the row", async () => {
		await repo.upsertBodyParts(MESSAGE_ID, [
			{
				partPath: "1",
				parentPartPath: null,
				mediaType: "TEXT",
				mediaSubtype: "plain",
				transferEncoding: "7BIT",
				sizeOctets: 256,
				isMultipart: false,
				parameters: [],
			},
		]);
		const data = await repo.getMessageData(MESSAGE_ID);
		const parts = data.bodyPart.filter((p) => p.partPath === "1");
		assert.equal(
			parts.length,
			1,
			"conflict update must not insert a second row",
		);
	});
});
