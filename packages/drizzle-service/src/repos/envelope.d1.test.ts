import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { BodyPartUpsertInput } from "@remit/data-ports";
import { ReferenceType } from "@remit/domain-enums";
import { openD1TestStore } from "../test-d1.js";
import { DrizzleEnvelopeRepository } from "./envelope.js";

const MESSAGE_ID = "00000000-0000-0000-4444-000000000d01";

const bodyPart = (index: number): BodyPartUpsertInput => ({
	partPath: `${index + 1}`,
	parentPartPath: null,
	mediaType: "TEXT",
	mediaSubtype: "plain",
	transferEncoding: "7BIT",
	sizeOctets: 128,
	isMultipart: false,
	parameters: [{ parameterName: "charset", parameterValue: "utf-8" }],
});

describe("DrizzleEnvelopeRepository on D1's 100 bound parameter limit", () => {
	let repo: DrizzleEnvelopeRepository;
	let close: () => Promise<void>;

	before(async () => {
		const opened = await openD1TestStore("mail");
		close = opened.close;
		repo = new DrizzleEnvelopeRepository(opened.store);
		await repo.upsertEnvelope({
			envelopeId: "ignored-derived",
			messageId: MESSAGE_ID,
			dateValue: 1700000000000,
			dateRaw: "Mon, 14 Nov 2023 08:00:00 +0000",
			subject: "Thirty parts",
		});
	});

	after(async () => {
		await close();
	});

	test("upsertBodyParts writes thirty parts and their parameters", async () => {
		await repo.upsertBodyParts(
			MESSAGE_ID,
			Array.from({ length: 30 }, (_, index) => bodyPart(index)),
		);

		const data = await repo.getMessageData(MESSAGE_ID);
		assert.equal(data.bodyPart.length, 30);
		assert.equal(data.bodyPartParameter.length, 30);
	});

	test("replaceMessageReferences writes thirty references", async () => {
		await repo.replaceMessageReferences(
			MESSAGE_ID,
			Array.from({ length: 30 }, (_, index) => ({
				messageIdValue: `<ref-${index}@example.com>`,
				referenceType: ReferenceType.References,
				referenceOrder: index,
			})),
		);

		const data = await repo.getMessageData(MESSAGE_ID);
		assert.equal(data.messageReference.length, 30);
	});
});
