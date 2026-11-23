import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { NODE_SQLITE_LIMITS } from "../bound-parameters.js";
import { createSqliteRepositories } from "../sqlite-repositories.js";
import { createTestDb, randomId } from "../test-db.js";
import { sharedDatabases } from "../test-sqlite.js";
import type { OutboxAttachmentRepo } from "./i4-outbox-attachment.js";
import { messageObjectsInMemory } from "./message-objects.js";

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
	repo = createSqliteRepositories(
		sharedDatabases(harness),
		NODE_SQLITE_LIMITS,
		messageObjectsInMemory(),
	).outboxAttachment;
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

describe("OutboxAttachmentRepo.renew", () => {
	test("never recreates a reservation cleanup deleted, even from a stale read", async () => {
		const cfg = randomId();
		const draft = randomId();
		const reservation = input(cfg, draft, 100, CAP.nowSeconds - 1);
		await repo.reserve(reservation, {
			...CAP,
			nowSeconds: CAP.nowSeconds - 10,
		});
		const stale = await repo.get(cfg, reservation.outboxAttachmentId);
		await repo.deleteLapsedReservations(cfg, draft, CAP.nowSeconds);
		assert.deepStrictEqual(
			await repo.renew(
				{ ...stale, reservationExpiresAt: CAP.nowSeconds + 900 },
				CAP,
			),
			{ outcome: "Missing" },
		);
		assert.strictEqual(
			await repo.markStored(cfg, stale.outboxAttachmentId, 100),
			null,
		);
		assert.deepStrictEqual(await repo.listByOutboxMessage(cfg, draft), []);
	});

	test("rechecks bytes and count without deleting a lapsed reservation", async () => {
		const cfg = randomId();
		const draft = randomId();
		const reservation = input(cfg, draft, 800, CAP.nowSeconds - 1);
		await repo.reserve(reservation, {
			...CAP,
			nowSeconds: CAP.nowSeconds - 10,
		});
		await repo.reserve(input(cfg, draft, 300), CAP);
		const renew = {
			...reservation,
			reservationExpiresAt: CAP.nowSeconds + 900,
		};
		assert.deepStrictEqual(await repo.renew(renew, CAP), {
			outcome: "OverByteCap",
			usedBytes: 300,
		});
		assert.deepStrictEqual(await repo.renew(renew, { ...CAP, maxCount: 1 }), {
			outcome: "OverCountCap",
			usedBytes: 300,
		});
		assert.strictEqual(
			(await repo.get(cfg, reservation.outboxAttachmentId))
				.reservationExpiresAt,
			reservation.reservationExpiresAt,
		);
	});

	test("concurrent renewals cannot reclaim the same quota twice", async () => {
		const cfg = randomId();
		const draft = randomId();
		const first = input(cfg, draft, 600, CAP.nowSeconds - 2);
		const second = input(cfg, draft, 600, CAP.nowSeconds - 1);
		await repo.reserve(first, { ...CAP, nowSeconds: CAP.nowSeconds - 10 });
		await repo.reserve(second, { ...CAP, nowSeconds: CAP.nowSeconds - 1 });
		const renewed = await Promise.all(
			[first, second].map((item) =>
				repo.renew(
					{ ...item, reservationExpiresAt: CAP.nowSeconds + 900 },
					CAP,
				),
			),
		);
		assert.strictEqual(
			renewed.filter((result) => result.outcome === "Reserved").length,
			1,
		);
		assert.strictEqual(
			renewed.filter((result) => result.outcome === "OverByteCap").length,
			1,
		);
	});

	test("renews only the existing tenant/draft Pending row", async () => {
		const cfg = randomId();
		const draft = randomId();
		const reservation = input(cfg, draft, 100);
		await repo.reserve(reservation, CAP);
		const renew = {
			...reservation,
			reservationExpiresAt: CAP.nowSeconds + 1800,
		};
		assert.deepStrictEqual(
			await repo.renew({ ...renew, accountConfigId: randomId() }, CAP),
			{ outcome: "Missing" },
		);
		assert.deepStrictEqual(
			await repo.renew({ ...renew, outboxMessageId: randomId() }, CAP),
			{ outcome: "Missing" },
		);
		assert.strictEqual((await repo.renew(renew, CAP)).outcome, "Reserved");
		assert.strictEqual(
			(await repo.get(cfg, reservation.outboxAttachmentId))
				.reservationExpiresAt,
			renew.reservationExpiresAt,
		);
		await repo.markStored(cfg, reservation.outboxAttachmentId, 100);
		assert.deepStrictEqual(await repo.renew(renew, CAP), {
			outcome: "Missing",
		});
	});
});
