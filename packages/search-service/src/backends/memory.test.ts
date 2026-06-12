import assert from "node:assert";
import { describe, it } from "node:test";
import type { ChunkMetadata, VectorRecord } from "../types.js";
import { MemoryVectorStore } from "./memory.js";

const buildMetadata = (
	overrides: Partial<ChunkMetadata> = {},
): ChunkMetadata => ({
	messageId: "msg-1",
	threadId: "thread-1",
	accountConfigId: "acct-1",
	mailboxIds: ["mb-inbox"],
	chunkType: "body",
	sentDate: 1_700_000_000,
	isRead: false,
	hasAttachment: false,
	hasStars: false,
	...overrides,
});

const record = (
	chunkId: string,
	vector: number[],
	overrides: Partial<ChunkMetadata> = {},
): VectorRecord => ({
	chunkId,
	vector,
	metadata: buildMetadata({ ...overrides }),
});

describe("MemoryVectorStore", () => {
	it("returns nearest matches in score-descending order", async () => {
		const store = new MemoryVectorStore();
		await store.upsert([
			record("a", [1, 0, 0]),
			record("b", [0, 1, 0]),
			record("c", [0.7, 0.7, 0]),
		]);

		const matches = await store.query({ vector: [1, 0, 0], topK: 3 });
		assert.strictEqual(matches.length, 3);
		assert.strictEqual(matches[0].chunkId, "a");
		assert.ok(matches[0].score > matches[1].score);
		assert.ok(matches[1].score >= matches[2].score);
	});

	it("respects topK", async () => {
		const store = new MemoryVectorStore();
		await store.upsert([
			record("a", [1, 0, 0]),
			record("b", [0, 1, 0]),
			record("c", [0, 0, 1]),
		]);

		const matches = await store.query({ vector: [1, 0, 0], topK: 1 });
		assert.strictEqual(matches.length, 1);
	});

	it("filters by mailboxId", async () => {
		const store = new MemoryVectorStore();
		await store.upsert([
			record("a", [1, 0, 0], { mailboxIds: ["mb-inbox"] }),
			record("b", [1, 0, 0], { mailboxIds: ["mb-archive"] }),
		]);

		const matches = await store.query({
			vector: [1, 0, 0],
			topK: 5,
			filter: { mailboxId: "mb-archive" },
		});
		assert.strictEqual(matches.length, 1);
		assert.strictEqual(matches[0].chunkId, "b");
	});

	it("filters by accountConfigId", async () => {
		const store = new MemoryVectorStore();
		await store.upsert([
			record("a", [1, 0, 0], { accountConfigId: "acct-1" }),
			record("b", [1, 0, 0], { accountConfigId: "acct-2" }),
		]);

		const matches = await store.query({
			vector: [1, 0, 0],
			topK: 5,
			filter: { accountConfigId: "acct-1" },
		});
		assert.strictEqual(matches.length, 1);
		assert.strictEqual(matches[0].chunkId, "a");
	});

	it("filters by sentDateRange", async () => {
		const store = new MemoryVectorStore();
		await store.upsert([
			record("old", [1, 0, 0], { sentDate: 100 }),
			record("mid", [1, 0, 0], { sentDate: 500 }),
			record("new", [1, 0, 0], { sentDate: 1000 }),
		]);

		const matches = await store.query({
			vector: [1, 0, 0],
			topK: 5,
			filter: { sentDateRange: { from: 200, to: 800 } },
		});
		const ids = matches.map((m) => m.chunkId).sort();
		assert.deepStrictEqual(ids, ["mid"]);
	});

	it("deletes all chunks for a given messageId", async () => {
		const store = new MemoryVectorStore();
		await store.upsert([
			record("a", [1, 0, 0], { messageId: "msg-1" }),
			record("b", [1, 0, 0], { messageId: "msg-1" }),
			record("c", [1, 0, 0], { messageId: "msg-2" }),
		]);

		await store.delete({ messageId: "msg-1" });

		const matches = await store.query({ vector: [1, 0, 0], topK: 5 });
		assert.strictEqual(matches.length, 1);
		assert.strictEqual(matches[0].chunkId, "c");
	});

	it("deleteKeys removes only the specified keys", async () => {
		const store = new MemoryVectorStore();
		await store.upsert([
			record("msg-1::subject", [1, 0, 0], { messageId: "msg-1" }),
			record("msg-1::body-0", [1, 0, 0], { messageId: "msg-1" }),
			record("msg-2::subject", [1, 0, 0], { messageId: "msg-2" }),
		]);

		await store.deleteKeys(["msg-1::subject", "msg-1::body-0"]);

		const matches = await store.query({ vector: [1, 0, 0], topK: 5 });
		assert.strictEqual(matches.length, 1);
		assert.strictEqual(matches[0].chunkId, "msg-2::subject");
	});

	it("upsert overwrites an existing record by chunkId", async () => {
		const store = new MemoryVectorStore();
		await store.upsert([record("a", [1, 0, 0])]);
		await store.upsert([record("a", [0, 1, 0])]);
		assert.strictEqual(store.size(), 1);

		const matches = await store.query({ vector: [0, 1, 0], topK: 1 });
		assert.ok(matches[0].score > 0.9);
	});
});
