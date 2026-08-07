import assert from "node:assert";
import { describe, test } from "node:test";
import { sweepAbandonedOutboxAttachments } from "./outbox-sweep.js";
import { createMockStorageService, type StorageService } from "./storage.js";

const CFG = "cfg1";
const ACC = "acc1";

const withObjects = async (
	drafts: Record<string, string[]>,
): Promise<StorageService> => {
	const storage = createMockStorageService();
	for (const [outboxMessageId, ids] of Object.entries(drafts)) {
		for (const outboxAttachmentId of ids) {
			await storage.storeOutboxAttachment({
				accountConfigId: CFG,
				accountId: ACC,
				outboxMessageId,
				outboxAttachmentId,
				content: Buffer.alloc(4),
			});
		}
	}
	return storage;
};

const remaining = (storage: StorageService, draft: string) =>
	storage
		.listOutboxAttachments(CFG, ACC, draft)
		.then((items) => items.map((item) => item.outboxAttachmentId).sort());

describe("sweepAbandonedOutboxAttachments", () => {
	test("deletes objects the database does not know about", async () => {
		const storage = await withObjects({ draft1: ["known", "orphan"] });

		const result = await sweepAbandonedOutboxAttachments(
			{
				storage,
				listKnownAttachmentIds: async () => ["known"],
				onSkipped: () => assert.fail("nothing should be skipped"),
			},
			CFG,
			ACC,
		);

		assert.deepStrictEqual(await remaining(storage, "draft1"), ["known"]);
		assert.strictEqual(result.deleted, 1);
		assert.strictEqual(result.skipped, 0);
	});

	test("empties the prefix of a draft the database has forgotten", async () => {
		// A discarded draft has no rows at all, and a presigned PUT can still have
		// landed under it. This is the case the sweep exists for.
		const storage = await withObjects({ discarded: ["a", "b"] });

		const result = await sweepAbandonedOutboxAttachments(
			{
				storage,
				listKnownAttachmentIds: async () => [],
				onSkipped: () => assert.fail("nothing should be skipped"),
			},
			CFG,
			ACC,
		);

		assert.deepStrictEqual(await remaining(storage, "discarded"), []);
		assert.strictEqual(result.deleted, 2);
	});

	test("leaves a draft alone when its rows cannot be read", async () => {
		// "I could not find out what is live" must never be acted on as "nothing
		// is live" — that would delete a whole draft's files on a transient error.
		const storage = await withObjects({ draft1: ["a", "b"] });
		const skips: string[] = [];

		const result = await sweepAbandonedOutboxAttachments(
			{
				storage,
				listKnownAttachmentIds: async () => {
					throw new Error("database unavailable");
				},
				onSkipped: (outboxMessageId) => skips.push(outboxMessageId),
			},
			CFG,
			ACC,
		);

		assert.deepStrictEqual(await remaining(storage, "draft1"), ["a", "b"]);
		assert.strictEqual(result.deleted, 0);
		assert.strictEqual(result.skipped, 1);
		assert.deepStrictEqual(skips, ["draft1"]);
	});

	test("one unreadable draft does not stop the others being collected", async () => {
		const storage = await withObjects({ bad: ["x"], good: ["orphan"] });

		const result = await sweepAbandonedOutboxAttachments(
			{
				storage,
				listKnownAttachmentIds: async (_cfg, outboxMessageId) => {
					if (outboxMessageId === "bad") throw new Error("unavailable");
					return [];
				},
				onSkipped: () => {},
			},
			CFG,
			ACC,
		);

		assert.deepStrictEqual(await remaining(storage, "bad"), ["x"]);
		assert.deepStrictEqual(await remaining(storage, "good"), []);
		assert.strictEqual(result.skipped, 1);
		assert.strictEqual(result.deleted, 1);
	});

	test("keeps an attachment reserved after the objects were listed", async () => {
		// Objects are listed before the rows are read, so a mint landing between
		// the two shows up as a row and is kept. The other order would delete it.
		const storage = await withObjects({ draft1: ["already-there"] });

		await sweepAbandonedOutboxAttachments(
			{
				storage,
				listKnownAttachmentIds: async () => ["already-there", "just-reserved"],
				onSkipped: () => {},
			},
			CFG,
			ACC,
		);

		assert.deepStrictEqual(await remaining(storage, "draft1"), [
			"already-there",
		]);
	});

	test("never reaches another tenant's objects", async () => {
		const storage = createMockStorageService();
		await storage.storeOutboxAttachment({
			accountConfigId: "cfg-other",
			accountId: ACC,
			outboxMessageId: "draft1",
			outboxAttachmentId: "theirs",
			content: Buffer.alloc(4),
		});

		const result = await sweepAbandonedOutboxAttachments(
			{
				storage,
				listKnownAttachmentIds: async () => [],
				onSkipped: () => {},
			},
			CFG,
			ACC,
		);

		assert.strictEqual(result.deleted, 0);
		assert.deepStrictEqual(
			(await storage.listOutboxAttachments("cfg-other", ACC, "draft1")).map(
				(item) => item.outboxAttachmentId,
			),
			["theirs"],
		);
	});
});
