import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { FilterScope } from "@remit/domain-enums";
import { NotFoundError } from "../error.js";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { FilterRepo } from "./filter.js";
import { FilterAnchorRepo } from "./filter-anchor.js";
import { DrizzleFilterAnchorTransaction } from "./filter-anchor-transaction.js";

describe("DrizzleFilterAnchorTransaction", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let transaction: DrizzleFilterAnchorTransaction;
	let filterRepo: FilterRepo;
	let filterAnchorRepo: FilterAnchorRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		transaction = new DrizzleFilterAnchorTransaction(db as never);
		filterRepo = new FilterRepo(db as never);
		filterAnchorRepo = new FilterAnchorRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("creates the Filter and its FilterAnchor together", async () => {
		const accountConfigId = randomId();

		const filter = await transaction.createWithAnchor(
			{
				accountConfigId,
				name: "Booking confirmations",
				scope: FilterScope.Standing,
				hasAnchor: true,
			},
			{
				accountConfigId,
				anchorMessageId: randomId(),
				anchorEmbedding: [0.1, 0.2, 0.3],
				anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
				anchorSourceText: "Your booking is confirmed",
			},
		);

		assert.equal(filter.hasAnchor, true);
		const anchor = await filterAnchorRepo.get(accountConfigId, filter.filterId);
		assert.ok(anchor, "the FilterAnchor row must exist");
		assert.equal(anchor?.anchorSourceText, "Your booking is confirmed");
	});

	test("creates a purely-literal Filter when anchor is null", async () => {
		const accountConfigId = randomId();

		const filter = await transaction.createWithAnchor(
			{
				accountConfigId,
				name: "From billing",
				scope: FilterScope.Standing,
				hasAnchor: false,
			},
			null,
		);

		assert.equal(filter.hasAnchor, false);
		const anchor = await filterAnchorRepo.get(accountConfigId, filter.filterId);
		assert.equal(anchor, null);
	});

	test("rolls back the Filter row when the FilterAnchor write fails (#351)", async () => {
		const accountConfigId = randomId();

		await assert.rejects(() =>
			transaction.createWithAnchor(
				{
					accountConfigId,
					name: "Broken anchor",
					scope: FilterScope.Standing,
					hasAnchor: true,
				},
				{
					accountConfigId,
					anchorMessageId: randomId(),
					anchorEmbedding: [0.1, 0.2, 0.3],
					anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
					// A NOT NULL column at the DB level — simulates a real write
					// failure on the second half of the pair (network blip,
					// transient error), the exact case #351 leaves broken today.
					anchorSourceText: null as unknown as string,
				},
			),
		);

		const filters = await filterRepo.listByAccountConfig(accountConfigId);
		assert.equal(
			filters.length,
			0,
			"the Filter row must not survive when its anchor write fails",
		);
	});

	test("the caller never sees a Filter row with hasAnchor: true and no anchor (#351)", async () => {
		const accountConfigId = randomId();

		await assert.rejects(() =>
			transaction.createWithAnchor(
				{
					accountConfigId,
					name: "Broken anchor 2",
					scope: FilterScope.Standing,
					hasAnchor: true,
				},
				{
					accountConfigId,
					anchorMessageId: randomId(),
					anchorEmbedding: [0.1, 0.2, 0.3],
					anchorEmbeddingId: "amazon.titan-embed-text-v2:0@1024",
					anchorSourceText: null as unknown as string,
				},
			),
		);

		const filters = await filterRepo.listByAccountConfig(accountConfigId);
		const orphan = filters.find((f) => f.hasAnchor);
		assert.equal(
			orphan,
			undefined,
			"no Filter with hasAnchor: true may exist without a FilterAnchor row",
		);
	});

	test("get on a never-created filter still throws NotFoundError (sanity)", async () => {
		await assert.rejects(filterRepo.get(randomId(), randomId()), NotFoundError);
	});
});
