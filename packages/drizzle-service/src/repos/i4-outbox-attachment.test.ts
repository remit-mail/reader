import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { createTestDb, randomId } from "../test-db.js";
import { OutboxAttachmentRepo } from "./i4-outbox-attachment.js";

const CAP = { maxTotalBytes: 1000, maxCount: 3, nowSeconds: 1_000_000 };

let harness: Awaited<ReturnType<typeof createTestDb>>;
let repo: OutboxAttachmentRepo;

const input = (
	accountConfigId: string,
	outboxMessageId: string,
	sizeBytes: number,
	reservationExpiresAt = CAP.nowSeconds + 900,
) => ({
	outboxAttachmentId: randomId(),
	outboxMessageId,
	accountId: "acc-1",
	accountConfigId,
	filename: "a.bin",
	contentType: "application/octet-stream",
	sizeBytes,
	storageKey: `accounts/${accountConfigId}/acc-1/outbox/${outboxMessageId}/attachments/x`,
	reservationExpiresAt,
});

before(async () => {
	harness = await createTestDb();
	repo = new OutboxAttachmentRepo(harness.db);
});

after(async () => {
	await harness.close();
});

describe("OutboxAttachmentRepo.reserve", () => {
	test("counts what a draft already holds and refuses what will not fit", async () => {
		const cfg = randomId();
		const draft = randomId();

		assert.strictEqual(
			(await repo.reserve(input(cfg, draft, 800), CAP)).outcome,
			"Reserved",
		);

		const over = await repo.reserve(input(cfg, draft, 300), CAP);
		assert.strictEqual(over.outcome, "OverByteCap");
		assert.strictEqual(over.outcome === "OverByteCap" && over.usedBytes, 800);
	});

	test("refuses past the file-count ceiling", async () => {
		const cfg = randomId();
		const draft = randomId();
		for (let index = 0; index < CAP.maxCount; index += 1) {
			assert.strictEqual(
				(await repo.reserve(input(cfg, draft, 1), CAP)).outcome,
				"Reserved",
			);
		}

		const over = await repo.reserve(input(cfg, draft, 1), CAP);
		assert.strictEqual(over.outcome, "OverCountCap");
	});

	test("holds the cap when reservations arrive together", async () => {
		// Counting and inserting are one transaction, so concurrent callers are
		// ordered by the database rather than each measuring a draft none of them
		// has written to. This is the whole of the cap.
		const cfg = randomId();
		const draft = randomId();

		const results = await Promise.all(
			Array.from({ length: 6 }, () =>
				repo.reserve(input(cfg, draft, 300), CAP),
			),
		);

		const reserved = results.filter((r) => r.outcome === "Reserved");
		assert.strictEqual(reserved.length, 3);
		const rows = await repo.listByOutboxMessage(cfg, draft);
		assert.strictEqual(rows.length, 3);
		assert.strictEqual(
			rows.reduce((total, row) => total + row.sizeBytes, 0),
			900,
		);
	});

	test("a lapsed reservation stops holding room", async () => {
		const cfg = randomId();
		const draft = randomId();
		await repo.reserve(input(cfg, draft, 900, CAP.nowSeconds - 1), CAP);

		assert.strictEqual(
			(await repo.reserve(input(cfg, draft, 900), CAP)).outcome,
			"Reserved",
		);
	});

	test("another tenant's rows are not counted, and cannot be read", async () => {
		const draft = randomId();
		const mine = randomId();
		const theirs = randomId();
		await repo.reserve(input(theirs, draft, 900), CAP);

		assert.strictEqual(
			(await repo.reserve(input(mine, draft, 900), CAP)).outcome,
			"Reserved",
		);
		assert.deepStrictEqual(await repo.listByOutboxMessage(mine, draft), [
			(await repo.listByOutboxMessage(mine, draft))[0],
		]);
	});
});

describe("OutboxAttachmentRepo.markStored", () => {
	test("moves a Pending row to Stored at the size storage holds", async () => {
		const cfg = randomId();
		const draft = randomId();
		const reserved = await repo.reserve(input(cfg, draft, 100), CAP);
		assert.strictEqual(reserved.outcome, "Reserved");
		if (reserved.outcome !== "Reserved") return;

		const stored = await repo.markStored(
			cfg,
			reserved.item.outboxAttachmentId,
			100,
		);

		assert.strictEqual(stored?.state, "Stored");
		// A Stored row holds room forever, so its expiry has nothing left to say.
		assert.strictEqual(stored?.reservationExpiresAt, 0);
	});

	test("answers null the second time, so a retry cannot double-confirm", async () => {
		const cfg = randomId();
		const draft = randomId();
		const reserved = await repo.reserve(input(cfg, draft, 100), CAP);
		assert.strictEqual(reserved.outcome, "Reserved");
		if (reserved.outcome !== "Reserved") return;

		await repo.markStored(cfg, reserved.item.outboxAttachmentId, 100);
		assert.strictEqual(
			await repo.markStored(cfg, reserved.item.outboxAttachmentId, 100),
			null,
		);
	});

	test("refuses to touch another tenant's row", async () => {
		const cfg = randomId();
		const draft = randomId();
		const reserved = await repo.reserve(input(cfg, draft, 100), CAP);
		assert.strictEqual(reserved.outcome, "Reserved");
		if (reserved.outcome !== "Reserved") return;

		assert.strictEqual(
			await repo.markStored(randomId(), reserved.item.outboxAttachmentId, 100),
			null,
		);
	});
});

describe("OutboxAttachmentRepo deletion", () => {
	test("deleteByOutboxMessage empties one draft and leaves the rest", async () => {
		const cfg = randomId();
		const kept = randomId();
		const gone = randomId();
		await repo.reserve(input(cfg, kept, 10), CAP);
		await repo.reserve(input(cfg, gone, 10), CAP);

		await repo.deleteByOutboxMessage(cfg, gone);

		assert.strictEqual((await repo.listByOutboxMessage(cfg, gone)).length, 0);
		assert.strictEqual((await repo.listByOutboxMessage(cfg, kept)).length, 1);
	});
});
