import assert from "node:assert";
import { test } from "node:test";
import { resolveType } from "./type-resolution.js";
import { DEFAULT_EXTRACTION_CONFIG } from "./types.js";

test("resolves via the declared media type when present and not octet-stream", async () => {
	const resolved = await resolveType(
		Buffer.from("plain text"),
		"text/plain",
		undefined,
		DEFAULT_EXTRACTION_CONFIG.allowedTypes,
	);

	assert.deepStrictEqual(resolved, {
		mediaType: "text/plain",
		extractor: "text",
	});
});

test("falls back to the filename extension when the declared type is octet-stream and bytes don't sniff", async () => {
	const resolved = await resolveType(
		Buffer.from("plain text"),
		"application/octet-stream",
		"notes.txt",
		DEFAULT_EXTRACTION_CONFIG.allowedTypes,
	);

	assert.deepStrictEqual(resolved, {
		mediaType: "text/plain",
		extractor: "text",
	});
});

test("returns undefined when the resolved type is outside allowedTypes", async () => {
	const resolved = await resolveType(
		Buffer.from("plain text"),
		"text/plain",
		undefined,
		["application/pdf"],
	);

	assert.strictEqual(resolved, undefined);
});

test("returns undefined when no type can be resolved at all", async () => {
	const resolved = await resolveType(
		Buffer.from([0x00, 0x01, 0x02]),
		"application/octet-stream",
		undefined,
		DEFAULT_EXTRACTION_CONFIG.allowedTypes,
	);

	assert.strictEqual(resolved, undefined);
});
