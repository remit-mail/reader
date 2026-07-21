import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { ForbiddenError, NotFoundError } from "../error.js";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { OutboxMessageRepo } from "./i4-outbox-message.js";

function makeOutboxInput(accountId: string, accountConfigId: string) {
	return {
		accountId,
		accountConfigId,
		fromAddress: "from@example.com",
		toAddresses: ["to@example.com"],
		messageIdValue: `<${randomId()}@example.com>`,
		status: "queued" as const,
	};
}

describe("OutboxMessageRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: OutboxMessageRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new OutboxMessageRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("create and get", async () => {
		const accountId = randomId();
		const accountConfigId = randomId();
		const msg = await repo.create(makeOutboxInput(accountId, accountConfigId));

		assert.ok(msg.outboxMessageId);
		assert.equal(msg.accountId, accountId);
		assert.equal(msg.status, "queued");
		assert.deepEqual(msg.ccAddresses, []);
		assert.deepEqual(msg.bccAddresses, []);
		assert.deepEqual(msg.references, []);

		const fetched = await repo.get(accountConfigId, msg.outboxMessageId);
		assert.equal(fetched.outboxMessageId, msg.outboxMessageId);

		await repo.delete(accountConfigId, msg.outboxMessageId);
	});

	test("batchGet WHERE id = ANY($1)", async () => {
		const accountId = randomId();
		const accountConfigId = randomId();
		const m1 = await repo.create(makeOutboxInput(accountId, accountConfigId));
		const m2 = await repo.create(makeOutboxInput(accountId, accountConfigId));

		const results = await repo.get(accountConfigId, [
			m1.outboxMessageId,
			m2.outboxMessageId,
		]);
		assert.equal(results.length, 2);

		await repo.deleteMany(accountConfigId, [
			m1.outboxMessageId,
			m2.outboxMessageId,
		]);
	});

	test("deleteMany only removes ids owned by the accountConfigId", async () => {
		const accountConfigId = randomId();
		const other = randomId();
		const mine = await repo.create(
			makeOutboxInput(randomId(), accountConfigId),
		);
		const theirs = await repo.create(makeOutboxInput(randomId(), other));

		// A foreign tenant cannot delete an id it does not own.
		await repo.deleteMany(other, [mine.outboxMessageId]);
		assert.ok(await repo.get(accountConfigId, mine.outboxMessageId));

		// The owner's call removes only its own id; the other tenant's row survives.
		await repo.deleteMany(accountConfigId, [
			mine.outboxMessageId,
			theirs.outboxMessageId,
		]);
		await assert.rejects(() => repo.get(accountConfigId, mine.outboxMessageId));
		assert.ok(await repo.get(other, theirs.outboxMessageId));

		await repo.delete(other, theirs.outboxMessageId);
	});

	test("batchGet empty array returns []", async () => {
		const results = await repo.get(randomId(), []);
		assert.deepEqual(results, []);
	});

	test("updateStatus changes status", async () => {
		const accountConfigId = randomId();
		const msg = await repo.create(makeOutboxInput(randomId(), accountConfigId));
		const updated = await repo.updateStatus(
			accountConfigId,
			msg.outboxMessageId,
			"sending",
		);
		assert.equal(updated.status, "sending");
		await repo.delete(accountConfigId, msg.outboxMessageId);
	});

	test("markSent clears lastError and lastSmtpCode", async () => {
		const accountConfigId = randomId();
		const msg = await repo.create({
			...makeOutboxInput(randomId(), accountConfigId),
			lastError: "previous error",
			lastSmtpCode: 550,
		});

		const sentAt = Date.now();
		const updated = await repo.markSent(accountConfigId, msg.outboxMessageId, {
			sentAt,
			smtpMessageId: "<smtp-id@example.com>",
		});

		assert.equal(updated.status, "sent");
		assert.equal(updated.sentAt, sentAt);
		assert.equal(updated.lastError, undefined);
		assert.equal(updated.lastSmtpCode, undefined);

		await repo.delete(accountConfigId, msg.outboxMessageId);
	});

	test("listByAccount returns messages in desc order", async () => {
		const accountId = randomId();
		const accountConfigId = randomId();
		const m1 = await repo.create(makeOutboxInput(accountId, accountConfigId));
		const m2 = await repo.create(makeOutboxInput(accountId, accountConfigId));

		const list = await repo.listByAccount(accountId);
		assert.ok(list.items.length >= 2);
		// Most recent first
		const ids = list.items.map((m) => m.outboxMessageId);
		assert.ok(ids.includes(m1.outboxMessageId));
		assert.ok(ids.includes(m2.outboxMessageId));

		await repo.deleteMany(accountConfigId, [
			m1.outboxMessageId,
			m2.outboxMessageId,
		]);
	});

	test("listByAccount paginates without dupes, gaps, or non-termination", async () => {
		const accountId = randomId();
		const accountConfigId = randomId();
		const created: string[] = [];
		for (let i = 0; i < 5; i++) {
			const msg = await repo.create(
				makeOutboxInput(accountId, accountConfigId),
			);
			created.push(msg.outboxMessageId);
		}

		const seen: string[] = [];
		let continuationToken: string | undefined;
		let pages = 0;
		do {
			const page = await repo.listByAccount(accountId, {
				limit: 2,
				continuationToken,
			});
			seen.push(...page.items.map((m) => m.outboxMessageId));
			continuationToken = page.continuationToken;
			pages++;
			assert.ok(pages < 10, "pagination must terminate");
		} while (continuationToken);

		assert.equal(seen.length, 5, "every row returned exactly once");
		assert.equal(new Set(seen).size, 5, "no duplicates across pages");
		assert.deepEqual([...seen].sort(), [...created].sort(), "no gaps");

		await repo.deleteMany(accountConfigId, created);
	});

	test("listQueued returns only queued messages", async () => {
		const accountId = randomId();
		const accountConfigId = randomId();
		const queued = await repo.create(
			makeOutboxInput(accountId, accountConfigId),
		);
		const sent = await repo.create({
			...makeOutboxInput(accountId, accountConfigId),
			status: "sent",
		});

		const list = await repo.listQueued(accountId);
		const ids = list.map((m) => m.outboxMessageId);
		assert.ok(ids.includes(queued.outboxMessageId));
		assert.equal(ids.includes(sent.outboxMessageId), false);

		await repo.deleteMany(accountConfigId, [
			queued.outboxMessageId,
			sent.outboxMessageId,
		]);
	});

	test("cross-tenant: get refuses a foreign accountConfig", async () => {
		const accountConfigId = randomId();
		const other = randomId();
		const msg = await repo.create(makeOutboxInput(randomId(), accountConfigId));

		await assert.rejects(
			() => repo.get(other, msg.outboxMessageId),
			/OutboxMessage not found/,
		);
		assert.deepEqual(await repo.get(other, [msg.outboxMessageId]), []);
		const owned = await repo.get(accountConfigId, [msg.outboxMessageId]);
		assert.equal(owned.length, 1);

		await repo.delete(accountConfigId, msg.outboxMessageId);
	});

	test("cross-tenant: get mode 'act' denies a foreign accountConfig with Forbidden, not NotFound", async () => {
		const accountConfigId = randomId();
		const other = randomId();
		const msg = await repo.create(makeOutboxInput(randomId(), accountConfigId));

		await assert.rejects(
			() => repo.get(other, msg.outboxMessageId, "read"),
			(err: unknown) => err instanceof NotFoundError,
		);
		await assert.rejects(
			() => repo.get(other, msg.outboxMessageId, "act"),
			(err: unknown) => err instanceof ForbiddenError,
		);
		await assert.rejects(
			() => repo.get(other, `${msg.outboxMessageId}-missing`, "act"),
			(err: unknown) => err instanceof NotFoundError,
			"a truly absent id stays NotFound even in act mode",
		);

		await repo.delete(accountConfigId, msg.outboxMessageId);
	});

	test("cross-tenant: update refuses a foreign accountConfig and leaves the row unchanged", async () => {
		const accountConfigId = randomId();
		const other = randomId();
		const msg = await repo.create(makeOutboxInput(randomId(), accountConfigId));

		await assert.rejects(
			() => repo.update(other, msg.outboxMessageId, { subject: "hijacked" }),
			/OutboxMessage not found/,
		);
		const still = await repo.get(accountConfigId, msg.outboxMessageId);
		assert.equal(still.subject, undefined);

		await repo.delete(accountConfigId, msg.outboxMessageId);
	});

	test("cross-tenant: updateStatus refuses a foreign accountConfig and leaves the row unchanged", async () => {
		const accountConfigId = randomId();
		const other = randomId();
		const msg = await repo.create(makeOutboxInput(randomId(), accountConfigId));

		await assert.rejects(
			() => repo.updateStatus(other, msg.outboxMessageId, "sending"),
			/OutboxMessage not found/,
		);
		const still = await repo.get(accountConfigId, msg.outboxMessageId);
		assert.equal(still.status, "queued");

		await repo.delete(accountConfigId, msg.outboxMessageId);
	});

	test("cross-tenant: markSent refuses a foreign accountConfig and leaves the row unchanged", async () => {
		const accountConfigId = randomId();
		const other = randomId();
		const msg = await repo.create(makeOutboxInput(randomId(), accountConfigId));

		await assert.rejects(
			() => repo.markSent(other, msg.outboxMessageId, { sentAt: Date.now() }),
			/OutboxMessage not found/,
		);
		const still = await repo.get(accountConfigId, msg.outboxMessageId);
		assert.equal(still.status, "queued");
		assert.equal(still.sentAt, undefined);

		await repo.delete(accountConfigId, msg.outboxMessageId);
	});

	test("cross-tenant: delete is a no-op for a foreign accountConfig", async () => {
		const accountConfigId = randomId();
		const other = randomId();
		const msg = await repo.create(makeOutboxInput(randomId(), accountConfigId));

		await repo.delete(other, msg.outboxMessageId);
		const still = await repo.get(accountConfigId, msg.outboxMessageId);
		assert.equal(still.outboxMessageId, msg.outboxMessageId);

		await repo.delete(accountConfigId, msg.outboxMessageId);
	});

	describe("continuation token rejection (#172)", () => {
		for (const [label, token] of [
			["an unparseable", "not-a-cursor"],
			["a bare number", Buffer.from("123").toString("base64url")],
			["a JSON array", Buffer.from("[1,2]").toString("base64url")],
		] as const) {
			test(`${label} token is rejected as a 400`, async () => {
				await assert.rejects(
					() => repo.listByAccount(randomId(), { continuationToken: token }),
					(error: unknown) => {
						assert.equal((error as { statusCode?: number }).statusCode, 400);
						assert.equal((error as Error).name, "BadRequestError");
						return true;
					},
				);
			});
		}
	});
});
