/**
 * Exercises the sqlite-vec store against a real in-memory vec0 table (the local
 * embedded-vector stack). Proves upsert, cosine ranking, content-hash lookup,
 * the getByMessage anchor-pooling read path, and delete round-trip through the
 * native extension.
 *
 * Gated behind RUN_INTEG_TESTS because it loads the native better-sqlite3 and
 * sqlite-vec binaries, matching the pgvector integration suite.
 *
 *   npm run test:integ -w packages/search-service
 */
import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import type { ChunkMetadata, VectorRecord } from "../types.js";
import type { VectorStoreService } from "./memory.js";
import { createSqliteVectorStore } from "./sqlite-vec.js";

const RUN = process.env.RUN_INTEG_TESTS === "1";
const DIMENSIONS = 4;

const meta = (
	over: Partial<ChunkMetadata> & { messageId: string },
): ChunkMetadata => ({
	threadId: "t-1",
	accountConfigId: "acc-1",
	mailboxIds: ["mb-1"],
	chunkType: "body",
	sentDate: 1000,
	isRead: false,
	hasAttachment: false,
	hasStars: false,
	...over,
});

const record = (
	chunkId: string,
	vector: number[],
	over: Partial<ChunkMetadata> & { messageId: string },
): VectorRecord => ({ chunkId, vector, metadata: meta(over) });

describe("sqlite-vec store (integration)", { skip: !RUN }, () => {
	let store: VectorStoreService;

	before(() => {
		store = createSqliteVectorStore({
			path: ":memory:",
			dimensions: DIMENSIONS,
		});
	});

	after(async () => {
		await store.close?.();
	});

	test("upsert then query ranks by cosine similarity", async () => {
		await store.upsert([
			record("c-x", [1, 0, 0, 0], { messageId: "m-x", contentHash: "hx" }),
			record("c-y", [0, 1, 0, 0], { messageId: "m-y", contentHash: "hy" }),
			record("c-z", [0.9, 0.1, 0, 0], { messageId: "m-z", contentHash: "hz" }),
		]);

		const matches = await store.query({ vector: [1, 0, 0, 0], topK: 3 });

		assert.equal(matches[0].chunkId, "c-x");
		assert.equal(matches[1].chunkId, "c-z");
		assert.equal(matches[2].chunkId, "c-y");
		assert.ok(matches[0].score > matches[1].score);
		assert.ok(matches[0].score > 0.99);
	});

	test("existingContentHashes returns stored hashes only for known keys", async () => {
		const hashes = await store.existingContentHashes(["c-x", "c-y", "missing"]);
		assert.equal(hashes.get("c-x"), "hx");
		assert.equal(hashes.get("c-y"), "hy");
		assert.equal(hashes.has("missing"), false);
	});

	test("getByMessage returns every chunk of a message with its vector and metadata", async () => {
		await store.upsert([
			record("g-sub", [1, 0, 0, 0], {
				messageId: "m-get",
				chunkType: "subject",
				contentHash: "hg1",
			}),
			record("g-body", [0, 1, 0, 0], {
				messageId: "m-get",
				chunkType: "body",
				contentHash: "hg2",
			}),
			record("g-other", [0, 0, 1, 0], { messageId: "m-other" }),
		]);

		const records = await store.getByMessage("m-get");

		const byId = new Map(records.map((r) => [r.chunkId, r]));
		assert.equal(records.length, 2, "only the message's own chunks");
		assert.deepEqual(byId.get("g-sub")?.vector, [1, 0, 0, 0]);
		assert.deepEqual(byId.get("g-body")?.vector, [0, 1, 0, 0]);
		assert.equal(byId.get("g-sub")?.metadata.chunkType, "subject");
		assert.equal(byId.get("g-body")?.metadata.messageId, "m-get");
	});

	test("getByMessage returns an empty array for an unknown message", async () => {
		assert.deepEqual(await store.getByMessage("m-absent"), []);
	});

	test("indexes a categoryless chunk and its category stays absent under a category filter", async () => {
		await store.upsert([
			record("cat-none", [1, 0, 0, 0], { messageId: "m-cat-none" }),
			record("cat-news", [1, 0, 0, 0], {
				messageId: "m-cat-news",
				category: "newsletter",
			}),
		]);

		const scoped = await store.query({
			vector: [1, 0, 0, 0],
			topK: 10,
			filter: { category: "newsletter" },
		});
		assert.deepEqual(
			scoped.map((m) => m.chunkId),
			["cat-news"],
			"a category filter excludes the categoryless chunk",
		);

		const [record0] = await store.getByMessage("m-cat-none");
		assert.equal(
			record0.metadata.category,
			undefined,
			"the categoryless chunk reads back with no category, not an empty string",
		);
	});

	test("delete removes every chunk of a message", async () => {
		await store.upsert([
			record("d-1", [1, 0, 0, 0], { messageId: "m-del" }),
			record("d-2", [0, 1, 0, 0], { messageId: "m-del" }),
		]);
		await store.delete({ messageId: "m-del" });
		const hashes = await store.existingContentHashes(["d-1", "d-2"]);
		assert.equal(hashes.size, 0);
	});
});
