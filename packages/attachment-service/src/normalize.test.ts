import assert from "node:assert";
import { test } from "node:test";
import { normalizeText, truncateToByteLimit } from "./normalize.js";

test("normalizeText strips NUL bytes", () => {
	const withNul = `hello${String.fromCharCode(0)}world`;
	assert.strictEqual(normalizeText(withNul), "helloworld");
});

test("normalizeText collapses runs of more than 2 blank lines down to 2", () => {
	const text = "one\n\n\n\n\n\ntwo";
	assert.strictEqual(normalizeText(text), "one\n\n\ntwo");
});

test("normalizeText leaves up to 2 blank lines untouched", () => {
	const text = "one\n\n\ntwo";
	assert.strictEqual(normalizeText(text), "one\n\n\ntwo");
});

test("truncateToByteLimit is a no-op under the limit", () => {
	const result = truncateToByteLimit("short text", 1000);
	assert.deepStrictEqual(result, { text: "short text", truncated: false });
});

test("truncateToByteLimit never splits a multi-byte UTF-8 sequence", () => {
	const text = "€".repeat(50);
	for (let limit = 1; limit <= Buffer.byteLength(text, "utf8"); limit++) {
		const { text: truncated } = truncateToByteLimit(text, limit);
		assert.ok(Buffer.byteLength(truncated, "utf8") <= limit);
		assert.strictEqual(
			Buffer.from(truncated, "utf8").toString("utf8"),
			truncated,
		);
	}
});
