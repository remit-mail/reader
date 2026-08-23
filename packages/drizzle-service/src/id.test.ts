import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	bodyPartContentId,
	bodyPartId,
	bodyPartParameterId,
	deterministicBase36Id,
	envelopeAddressId,
	envelopeId,
	generateDeterministicId,
	rootBodyPartId,
} from "./id.js";

const MESSAGE = "message-golden";

describe("derived ids are stored primary keys: a changed value orphans every row already written and needs a migration, never a new expectation here", () => {
	test("generateDeterministicId pins the namespace and the UUIDv5 encoding", () => {
		assert.equal(
			generateDeterministicId("golden-seed"),
			"68dd8eea-ad03-5221-b37c-52bbf1772c30",
		);
	});

	test("deterministicBase36Id pins the base36 encoding shared with the electrodb adapter", () => {
		assert.equal(
			deterministicBase36Id("golden-seed"),
			"67hxxs95ofdk5frbprqyrgwmo",
		);
	});

	test("bodyPartId pins the body_part primary key", () => {
		assert.equal(
			bodyPartId(MESSAGE, "1.2"),
			"022d58cc-585c-5391-8106-f2d2c1c0b228",
		);
	});

	test("rootBodyPartId pins the root MIME node's key, part path 0", () => {
		assert.equal(
			rootBodyPartId(MESSAGE),
			"f15cb8cc-8e03-5d68-812a-70bac87e2261",
		);
	});

	test("bodyPartParameterId pins the body_part_parameter primary key", () => {
		assert.equal(
			bodyPartParameterId(MESSAGE, "1.2", "charset"),
			"fdac41cc-7cbf-5bf7-bfb3-48f66e2e7f0c",
		);
	});

	test("envelopeId pins the envelope primary key", () => {
		assert.equal(envelopeId(MESSAGE), "fdfd34a1-84fb-535f-a586-965338211e99");
	});

	test("envelopeAddressId pins the envelope_address primary key", () => {
		assert.equal(
			envelopeAddressId(MESSAGE, "to", 1),
			"5f4e930e-e418-51a2-9402-657822f8688b",
		);
	});

	test("bodyPartContentId pins the body_part_content primary key", () => {
		assert.equal(
			bodyPartContentId(MESSAGE, "bodypart-golden"),
			"c0ee5f7d-1894-5957-9f65-d9aafdf306ab",
		);
	});
});
