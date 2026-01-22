import assert from "node:assert";
import { describe, it } from "node:test";
import { extractDomain, generateMessageId } from "./message-id.js";

describe("Message-ID generation", () => {
	it("generates unique message IDs", () => {
		const id1 = generateMessageId("example.com");
		const id2 = generateMessageId("example.com");
		assert.notStrictEqual(id1, id2);
	});

	it("includes domain in message ID", () => {
		const id = generateMessageId("test.example.com");
		assert.ok(id.endsWith("@test.example.com"));
	});

	it("contains timestamp and random hex", () => {
		const id = generateMessageId("example.com");
		const parts = id.split("@")[0].split(".");
		assert.strictEqual(parts.length, 2);
		// First part is timestamp (numeric)
		assert.ok(/^\d+$/.test(parts[0]));
		// Second part is hex string
		assert.ok(/^[0-9a-f]+$/.test(parts[1]));
	});
});

describe("extractDomain", () => {
	it("extracts domain from email", () => {
		assert.strictEqual(extractDomain("user@example.com"), "example.com");
	});

	it("handles email with + alias", () => {
		assert.strictEqual(extractDomain("user+tag@example.com"), "example.com");
	});

	it("handles subdomain", () => {
		assert.strictEqual(
			extractDomain("user@mail.example.com"),
			"mail.example.com",
		);
	});

	it("uses last @ for edge cases", () => {
		assert.strictEqual(extractDomain("user@name@example.com"), "example.com");
	});

	it("throws on invalid email", () => {
		assert.throws(() => extractDomain("invalid"), /Invalid email/);
	});
});
