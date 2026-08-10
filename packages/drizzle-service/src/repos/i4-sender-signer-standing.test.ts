import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { NotFoundError } from "../error.js";
import { senderSignerStandingTable } from "../schema.js";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { SenderSignerStandingRepo } from "./i4-sender-signer-standing.js";

describe("SenderSignerStandingRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: SenderSignerStandingRepo;

	const rowsFor = async (accountConfigId: string) =>
		db
			.select()
			.from(senderSignerStandingTable)
			.where(eq(senderSignerStandingTable.accountConfigId, accountConfigId));

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new SenderSignerStandingRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("observing a new key inserts one row at a count of one", async () => {
		const accountConfigId = randomId();
		const observedAt = 1_700_000_000_000;

		const standing = await repo.observe({
			accountConfigId,
			senderKey: "vip.example",
			signerDomain: "esp.example",
			observedAt,
		});

		assert.equal(standing.messageCount, 1);
		assert.equal(standing.firstSeenAt, observedAt);
		assert.equal(standing.lastSeenAt, observedAt);
		assert.equal(standing.userAffirmedAt, 0);
		assert.equal((await rowsFor(accountConfigId)).length, 1);
	});

	test("observing the same key again increments the count in place rather than inserting a second row", async () => {
		const accountConfigId = randomId();
		const key = {
			accountConfigId,
			senderKey: "vip.example",
			signerDomain: "esp.example",
		};

		await repo.observe({ ...key, observedAt: 1_700_000_000_000 });
		await repo.observe({ ...key, observedAt: 1_700_000_060_000 });
		const third = await repo.observe({
			...key,
			observedAt: 1_700_000_120_000,
		});

		assert.equal(third.messageCount, 3);
		const rows = await rowsFor(accountConfigId);
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.messageCount, 3);
	});

	// The failure this guards is silent: naming first_seen_at in the conflict
	// `set` makes every message reset the key's age, so standing reads as
	// brand-new forever and nothing downstream can tell.
	test("a repeat leaves firstSeenAt at the first observation while lastSeenAt follows the latest", async () => {
		const accountConfigId = randomId();
		const key = {
			accountConfigId,
			senderKey: "list.example",
			signerDomain: "unverified",
		};
		const first = 1_600_000_000_000;

		await repo.observe({ ...key, observedAt: first });
		await repo.observe({ ...key, observedAt: first + 3_600_000 });
		const latest = await repo.observe({
			...key,
			observedAt: first + 7_200_000,
		});

		assert.equal(latest.firstSeenAt, first);
		assert.equal(latest.lastSeenAt, first + 7_200_000);

		const [row] = await rowsFor(accountConfigId);
		assert.equal(row?.firstSeenAt, first);
		assert.equal(row?.lastSeenAt, first + 7_200_000);
	});

	test("an out-of-order observation still counts, and never rewrites firstSeenAt", async () => {
		const accountConfigId = randomId();
		const key = {
			accountConfigId,
			senderKey: "delayed.example",
			signerDomain: "esp.example",
		};
		const first = 1_650_000_000_000;

		await repo.observe({ ...key, observedAt: first });
		const older = await repo.observe({
			...key,
			observedAt: first - 86_400_000,
		});

		assert.equal(older.messageCount, 2);
		assert.equal(older.firstSeenAt, first);
	});

	test("the same sender under two signer domains keeps two independent rows", async () => {
		const accountConfigId = randomId();
		const observedAt = 1_700_000_000_000;

		await repo.observe({
			accountConfigId,
			senderKey: "shop.example",
			signerDomain: "esp-one.example",
			observedAt,
		});
		await repo.observe({
			accountConfigId,
			senderKey: "shop.example",
			signerDomain: "esp-one.example",
			observedAt,
		});
		const other = await repo.observe({
			accountConfigId,
			senderKey: "shop.example",
			signerDomain: "esp-two.example",
			observedAt,
		});

		assert.equal(other.messageCount, 1);
		assert.equal((await rowsFor(accountConfigId)).length, 2);
	});

	test("standing never crosses accounts", async () => {
		const mine = randomId();
		const theirs = randomId();
		const key = {
			senderKey: "shared.example",
			signerDomain: "esp.example",
			observedAt: 1_700_000_000_000,
		};

		await repo.observe({ accountConfigId: mine, ...key });
		await repo.observe({ accountConfigId: mine, ...key });
		const foreign = await repo.observe({ accountConfigId: theirs, ...key });

		assert.equal(foreign.messageCount, 1);
		assert.equal(
			(await repo.get(mine, key.senderKey, key.signerDomain)).messageCount,
			2,
		);
	});

	test("get raises NotFoundError for a key that was never observed", async () => {
		await assert.rejects(
			repo.get(randomId(), "stranger.example", "esp.example"),
			(error) => error instanceof NotFoundError,
		);
	});

	test("get reads back the row the last observation returned", async () => {
		const accountConfigId = randomId();
		const key = {
			accountConfigId,
			senderKey: "readback.example",
			signerDomain: "esp.example",
		};

		const written = await repo.observe({
			...key,
			observedAt: 1_700_000_000_000,
		});
		const read = await repo.get(
			accountConfigId,
			key.senderKey,
			key.signerDomain,
		);

		assert.deepEqual(read, written);
	});
});
