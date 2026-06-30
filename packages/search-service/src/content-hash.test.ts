import assert from "node:assert";
import { describe, it } from "node:test";
import { computeContentHash } from "./content-hash.js";

describe("computeContentHash", () => {
	it("is stable for the same model id and text", () => {
		const a = computeContentHash("model@1024", "hello world");
		const b = computeContentHash("model@1024", "hello world");
		assert.strictEqual(a, b);
	});

	it("changes when the text changes", () => {
		const a = computeContentHash("model@1024", "hello world");
		const b = computeContentHash("model@1024", "hello there");
		assert.notStrictEqual(a, b);
	});

	it("changes when the embedding model/version id changes", () => {
		const a = computeContentHash("model@1024", "hello world");
		const b = computeContentHash("model@512", "hello world");
		assert.notStrictEqual(a, b);
	});

	it("returns a hex sha256 digest", () => {
		assert.match(computeContentHash("m", "x"), /^[0-9a-f]{64}$/);
	});
});
