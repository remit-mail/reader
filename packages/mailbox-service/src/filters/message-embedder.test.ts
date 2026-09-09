import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	_resetMessageEmbedderForTest,
	getMessageEmbedder,
} from "./message-embedder.js";

describe("getMessageEmbedder", () => {
	afterEach(() => {
		_resetMessageEmbedderForTest();
	});

	it("adapts the batch embedding service into a single-text message embedder", async () => {
		const vector = await getMessageEmbedder().embed("invoice from stripe");

		assert.ok(Array.isArray(vector));
		assert.ok(vector.length > 0);
		assert.ok(vector.every((value) => typeof value === "number"));
	});

	it("embeds the same text deterministically", async () => {
		const embedder = getMessageEmbedder();
		const a = await embedder.embed("your monthly receipt");
		const b = await embedder.embed("your monthly receipt");

		assert.deepEqual(a, b);
	});

	it("memoizes the embedder across calls", () => {
		assert.strictEqual(getMessageEmbedder(), getMessageEmbedder());
	});

	it("rebuilds after a reset", () => {
		const first = getMessageEmbedder();
		_resetMessageEmbedderForTest();

		assert.notStrictEqual(getMessageEmbedder(), first);
	});
});
