import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { BodyPartUpsertInput } from "@remit/data-ports";
import { envelopeId as deriveEnvelopeId } from "../id.js";
import { DrizzleEnvelopeRepository } from "./envelope.js";
import { createTestDb, type TestDb } from "./test-helpers.js";

describe("DrizzleEnvelopeRepository", () => {
	let db: TestDb;
	let stop: () => Promise<void>;
	let repo: DrizzleEnvelopeRepository;

	const MESSAGE_ID = "00000000-0000-0000-0000-000000000001";
	const ENVELOPE_ID = deriveEnvelopeId(MESSAGE_ID);
	const ADDRESS_ID = "00000000-0000-0000-0000-000000000003";
	const ENVELOPE_ADDR_ID = "00000000-0000-0000-0000-000000000004";
	const NOW = 1700000000000;

	before(async () => {
		({ db, stop } = await createTestDb());
		repo = new DrizzleEnvelopeRepository(db);

		await repo.upsertEnvelope({
			envelopeId: ENVELOPE_ID,
			messageId: MESSAGE_ID,
			dateValue: NOW,
			dateRaw: "Mon, 14 Nov 2023 08:00:00 +0000",
			subject: "Hello World",
			messageIdValue: "<test@example.com>",
		});
	});

	after(async () => {
		await stop();
	});

	describe("getMessageData — MessageData shape (8 members)", () => {
		test("returns all 8 collection members", async () => {
			const data = await repo.getMessageData(MESSAGE_ID);
			const keys = Object.keys(data).sort();
			assert.deepStrictEqual(keys, [
				"bodyPart",
				"bodyPartContent",
				"bodyPartParameter",
				"bodyPartStorage",
				"envelope",
				"envelopeAddress",
				"messageReference",
				"rawMessageStorage",
			]);
		});

		test("envelope has 1 row with correct fields", async () => {
			const data = await repo.getMessageData(MESSAGE_ID);
			assert.equal(data.envelope.length, 1);
			const env = data.envelope[0];
			assert.equal(env.envelopeId, ENVELOPE_ID);
			assert.equal(env.messageId, MESSAGE_ID);
			assert.equal(env.dateValue, NOW);
			assert.equal(env.dateRaw, "Mon, 14 Nov 2023 08:00:00 +0000");
			assert.equal(env.subject, "Hello World");
			assert.equal(env.messageIdValue, "<test@example.com>");
		});

		test("empty collections return empty arrays", async () => {
			const data = await repo.getMessageData(MESSAGE_ID);
			assert.equal(data.messageReference.length, 0);
			assert.equal(data.envelopeAddress.length, 0);
			assert.equal(data.bodyPart.length, 0);
			assert.equal(data.bodyPartParameter.length, 0);
			assert.equal(data.rawMessageStorage.length, 0);
			assert.equal(data.bodyPartStorage.length, 0);
			assert.equal(data.bodyPartContent.length, 0);
		});

		test("throws NotFoundError for unknown messageId", async () => {
			await assert.rejects(
				() => repo.getMessageData("00000000-0000-0000-0000-999999999999"),
				(err: Error) => {
					assert.equal(err.name, "NotFoundError");
					return true;
				},
			);
		});
	});

	describe("upsertBodyParts — idempotent single-transaction write", () => {
		const PART: BodyPartUpsertInput = {
			partPath: "1",
			parentPartPath: null,
			mediaType: "TEXT",
			mediaSubtype: "plain",
			transferEncoding: "7BIT",
			sizeOctets: 42,
			isMultipart: false,
			parameters: [{ parameterName: "charset", parameterValue: "utf-8" }],
		};

		test("upserts body parts and parameters", async () => {
			await repo.upsertBodyParts(MESSAGE_ID, [PART]);
			const parts = await repo.listBodyParts(MESSAGE_ID);
			assert.equal(parts.length, 1);
			assert.equal(parts[0].partPath, "1");
			assert.equal(parts[0].mediaType, "TEXT");
		});

		test("idempotent — second upsert does not duplicate", async () => {
			await repo.upsertBodyParts(MESSAGE_ID, [PART]);
			await repo.upsertBodyParts(MESSAGE_ID, [PART]);
			const parts = await repo.listBodyParts(MESSAGE_ID);
			assert.equal(
				parts.length,
				1,
				"should still have exactly 1 body part after re-upsert",
			);
		});

		test("duplicate partPath in one call does not throw and writes one row", async () => {
			// The MIME walker can hand back two nodes with the same synthetic
			// partPath (e.g. the inner body of a message/rfc822 attachment),
			// yielding duplicate bodyPartIds in a single insert. A single
			// INSERT ... ON CONFLICT DO UPDATE would raise SQLSTATE 21000 unless
			// we dedupe first.
			const DUP_MSG_ID = "00000000-0000-0000-0000-000000000077";
			const duped: BodyPartUpsertInput[] = [
				{
					partPath: "2",
					parentPartPath: null,
					mediaType: "MESSAGE",
					mediaSubtype: "rfc822",
					transferEncoding: "7BIT",
					sizeOctets: 10,
					isMultipart: false,
					parameters: [{ parameterName: "charset", parameterValue: "utf-8" }],
				},
				{
					partPath: "2",
					parentPartPath: null,
					mediaType: "TEXT",
					mediaSubtype: "plain",
					transferEncoding: "7BIT",
					sizeOctets: 20,
					isMultipart: false,
					parameters: [{ parameterName: "charset", parameterValue: "latin1" }],
				},
			];

			await assert.doesNotReject(() => repo.upsertBodyParts(DUP_MSG_ID, duped));

			const parts = await repo.listBodyParts(DUP_MSG_ID);
			const matching = parts.filter((p) => p.partPath === "2");
			assert.equal(
				matching.length,
				1,
				"duplicate partPath must collapse to exactly one row",
			);
		});
	});

	describe("deleteManyEnvelopes — single-transaction delete", () => {
		const DEL_MSG_ID = "00000000-0000-0000-0000-000000000099";
		const DEL_ENV_ID = deriveEnvelopeId(DEL_MSG_ID);

		before(async () => {
			await repo.upsertEnvelope({
				envelopeId: DEL_ENV_ID,
				messageId: DEL_MSG_ID,
				dateValue: NOW,
				dateRaw: "Mon, 14 Nov 2023 08:00:00 +0000",
			});
		});

		test("deletes the specified envelopes", async () => {
			await repo.deleteManyEnvelopes([DEL_ENV_ID]);
			await assert.rejects(
				() => repo.getMessageData(DEL_MSG_ID),
				(err: Error) => {
					assert.equal(err.name, "NotFoundError");
					return true;
				},
			);
		});

		test("no-op on empty array", async () => {
			await assert.doesNotReject(() => repo.deleteManyEnvelopes([]));
		});
	});

	describe("envelopeAddress — verifies envelopeAddress in getMessageData", () => {
		before(async () => {
			const { envelopeAddressTable } = await import(
				"../schema/message-data.js"
			);
			await db
				.insert(envelopeAddressTable)
				.values({
					envelopeAddressId: ENVELOPE_ADDR_ID,
					messageId: MESSAGE_ID,
					addressId: ADDRESS_ID,
					normalizedEmail: "alice@example.com",
					displayName: "Alice",
					addressRole: "from",
					addressOrder: 0,
					createdAt: NOW,
					updatedAt: NOW,
				})
				.onConflictDoNothing();
		});

		test("getMessageData includes envelopeAddress rows", async () => {
			const data = await repo.getMessageData(MESSAGE_ID);
			assert.ok(
				data.envelopeAddress.length >= 1,
				"should have at least one address",
			);
			const addr = data.envelopeAddress.find(
				(a) => a.envelopeAddressId === ENVELOPE_ADDR_ID,
			);
			assert.ok(addr, "should find the inserted address");
			assert.equal(addr.normalizedEmail, "alice@example.com");
			assert.equal(addr.displayName, "Alice");
			assert.equal(addr.addressRole, "from");
		});
	});
});
