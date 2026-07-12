import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { FilterAnchorRepo } from "./filter-anchor.js";

describe("FilterAnchorRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: FilterAnchorRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new FilterAnchorRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("put creates the row and round-trips the anchor vector", async () => {
		const accountConfigId = randomId();
		const filterId = randomId();
		const anchorMessageId = randomId();
		const anchorEmbedding = [0.1, -0.2, 0.3, 0];

		const anchor = await repo.put({
			accountConfigId,
			filterId,
			anchorEmbedding,
			anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
			anchorSourceText: "Your booking is confirmed for...",
			anchorMessageId,
		});

		assert.deepEqual(anchor.anchorEmbedding, anchorEmbedding);
		assert.equal(anchor.anchorMessageId, anchorMessageId);
	});

	test("get returns null when no anchor exists for the filter", async () => {
		const anchor = await repo.get(randomId(), randomId());
		assert.equal(anchor, null);
	});

	test("put upserts — a re-embed migration overwrites the existing row", async () => {
		const accountConfigId = randomId();
		const filterId = randomId();
		const anchorMessageId = randomId();

		await repo.put({
			accountConfigId,
			filterId,
			anchorEmbedding: [1, 2, 3],
			anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
			anchorSourceText: "original",
			anchorMessageId,
		});

		const migrated = await repo.put({
			accountConfigId,
			filterId,
			anchorEmbedding: [4, 5, 6],
			anchorEmbeddingId: "amazon.titan-embed-text-v3:0@1536",
			anchorSourceText: "original",
			anchorMessageId,
		});

		assert.deepEqual(migrated.anchorEmbedding, [4, 5, 6]);
		assert.equal(
			migrated.anchorEmbeddingId,
			"amazon.titan-embed-text-v3:0@1536",
		);

		const reread = await repo.get(accountConfigId, filterId);
		assert.deepEqual(reread?.anchorEmbedding, [4, 5, 6]);
	});

	test("listByAccountConfig returns every anchor for the account config", async () => {
		const accountConfigId = randomId();
		const filterIdA = randomId();
		const filterIdB = randomId();
		const otherConfigId = randomId();
		const otherFilterId = randomId();

		await repo.put({
			accountConfigId,
			filterId: filterIdA,
			anchorEmbedding: [1, 2, 3],
			anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
			anchorSourceText: "a",
			anchorMessageId: randomId(),
		});
		await repo.put({
			accountConfigId,
			filterId: filterIdB,
			anchorEmbedding: [4, 5, 6],
			anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
			anchorSourceText: "b",
			anchorMessageId: randomId(),
		});
		await repo.put({
			accountConfigId: otherConfigId,
			filterId: otherFilterId,
			anchorEmbedding: [7, 8, 9],
			anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
			anchorSourceText: "other",
			anchorMessageId: randomId(),
		});

		const anchors = await repo.listByAccountConfig(accountConfigId);
		const filterIds = anchors.map((a) => a.filterId).sort();
		assert.deepEqual(filterIds, [filterIdA, filterIdB].sort());
	});

	test("delete removes the row", async () => {
		const accountConfigId = randomId();
		const filterId = randomId();

		await repo.put({
			accountConfigId,
			filterId,
			anchorEmbedding: [1],
			anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
			anchorSourceText: "text",
			anchorMessageId: randomId(),
		});

		await repo.delete(accountConfigId, filterId);

		assert.equal(await repo.get(accountConfigId, filterId), null);
	});
});
