import assert from "node:assert";
import { describe, it } from "node:test";
import type { EnvelopeChunkInput } from "../types.js";
import {
	buildStructuredChunks,
	extractAttachmentFileTypes,
} from "./structured.js";

const baseEnvelope: EnvelopeChunkInput = {
	from: { name: "Alice", email: "alice@example.com" },
	to: [{ name: "Bob", email: "bob@example.com" }],
	cc: [],
	bcc: [],
	subject: "Q1 invoice review",
	attachments: [],
};

const idFor = (suffix: string): string => `msg-1::${suffix}`;

describe("buildStructuredChunks", () => {
	it("emits sender, recipient, and subject chunks for a basic envelope", () => {
		const chunks = buildStructuredChunks(baseEnvelope, idFor);
		const types = chunks.map((c) => c.chunkType);
		assert.deepStrictEqual(types, ["sender", "recipient", "subject"]);

		const sender = chunks.find((c) => c.chunkType === "sender");
		assert.ok(sender);
		assert.match(sender.text, /alice@example\.com/);
		assert.match(sender.text, /Alice/);

		const recipient = chunks.find((c) => c.chunkType === "recipient");
		assert.ok(recipient);
		assert.match(recipient.text, /bob@example\.com/);

		const subject = chunks.find((c) => c.chunkType === "subject");
		assert.ok(subject);
		assert.match(subject.text, /Q1 invoice review/);
	});

	it("uses email-only when sender has no display name", () => {
		const chunks = buildStructuredChunks(
			{ ...baseEnvelope, from: { name: null, email: "alice@example.com" } },
			idFor,
		);
		const sender = chunks.find((c) => c.chunkType === "sender");
		assert.ok(sender);
		assert.strictEqual(sender.text, "From: alice@example.com");
	});

	it("merges to/cc/bcc into a single recipient chunk", () => {
		const chunks = buildStructuredChunks(
			{
				...baseEnvelope,
				to: [{ name: "Bob", email: "bob@example.com" }],
				cc: [{ name: "Carol", email: "carol@example.com" }],
				bcc: [{ name: null, email: "dave@example.com" }],
			},
			idFor,
		);
		const recipients = chunks.filter((c) => c.chunkType === "recipient");
		assert.strictEqual(recipients.length, 1);
		assert.match(recipients[0].text, /bob@example\.com/);
		assert.match(recipients[0].text, /carol@example\.com/);
		assert.match(recipients[0].text, /dave@example\.com/);
	});

	it("emits an attachment chunk when attachments are present", () => {
		const chunks = buildStructuredChunks(
			{
				...baseEnvelope,
				attachments: [
					{
						filename: "invoice-q1-2026.pdf",
						contentType: "application/pdf",
						size: 245_000,
					},
					{
						filename: "summary.xlsx",
						contentType:
							"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
						size: 89_000,
					},
				],
			},
			idFor,
		);
		const att = chunks.find((c) => c.chunkType === "attachment");
		assert.ok(att);
		assert.match(att.text, /invoice-q1-2026\.pdf/);
		assert.match(att.text, /application\/pdf/);
		assert.match(att.text, /summary\.xlsx/);
	});

	it("skips empty subject and missing recipients", () => {
		const chunks = buildStructuredChunks(
			{ ...baseEnvelope, to: [], subject: "" },
			idFor,
		);
		const types = chunks.map((c) => c.chunkType);
		assert.deepStrictEqual(types, ["sender"]);
	});

	it("uses deterministic chunk ids derived from the messageId", () => {
		const chunks = buildStructuredChunks(baseEnvelope, idFor);
		assert.ok(chunks.every((c) => c.chunkId.startsWith("msg-1::")));
	});
});

describe("extractAttachmentFileTypes", () => {
	it("dedupes and lowercases extensions and content subtypes", () => {
		const types = extractAttachmentFileTypes([
			{ filename: "INVOICE.PDF", contentType: "application/pdf", size: 100 },
			{ filename: "summary.xlsx", contentType: "application/xlsx", size: 200 },
			{ filename: "another.pdf", contentType: "application/pdf", size: 100 },
		]);
		assert.ok(types.includes("pdf"));
		assert.ok(types.includes("xlsx"));
		assert.strictEqual(new Set(types).size, types.length);
	});
});
