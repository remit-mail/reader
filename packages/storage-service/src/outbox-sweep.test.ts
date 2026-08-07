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

	test("an attachment that lands between the two reads is kept", async () => {
		// Objects are listed before the rows are read. A mint that lands in that
		// window is seen as a row and not as an object, so it survives. Read the
		// rows first and the same mint is an object with no row behind it — this
		// fails if those two lines ever swap.
		const storage = await withObjects({ draft1: ["already-there"] });
		let listedObjects = false;

		const inner = storage.listOutboxAttachments.bind(storage);
		const observing = {
			...storage,
			listOutboxAttachments: async (
				accountConfigId: string,
				accountId: string,
				outboxMessageId: string,
			) => {
				listedObjects = true;
				return inner(accountConfigId, accountId, outboxMessageId);
			},
		} as StorageService;

		await sweepAbandonedOutboxAttachments(
			{
				storage: observing,
				listKnownAttachmentIds: async () => {
					assert.strictEqual(
						listedObjects,
						true,
						"rows must be read after the objects were listed, never before",
					);
					// The mint that landed in the window.
					await storage.storeOutboxAttachment({
						accountConfigId: CFG,
						accountId: ACC,
						outboxMessageId: "draft1",
						outboxAttachmentId: "just-reserved",
						content: Buffer.alloc(4),
					});
					return ["already-there", "just-reserved"];
				},
				onSkipped: () => {},
			},
			CFG,
			ACC,
		);

		assert.deepStrictEqual(await remaining(storage, "draft1"), [
			"already-there",
			"just-reserved",
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
