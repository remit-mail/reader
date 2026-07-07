import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { AccountRepo } from "./i4-account.js";
import { AccountConfigRepo } from "./i4-account-config.js";
import { AddressRepo } from "./i4-address.js";

describe("AccountConfigRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: AccountConfigRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new AccountConfigRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("create and get", async () => {
		const userId = randomId();
		const cfg = await repo.create({ userId, name: "My Config" });

		assert.ok(cfg.accountConfigId);
		assert.equal(cfg.userId, userId);
		assert.equal(cfg.name, "My Config");
		assert.equal(cfg.state, "active");

		const fetched = await repo.get(cfg.accountConfigId);
		assert.equal(fetched.accountConfigId, cfg.accountConfigId);

		await repo.delete(cfg.accountConfigId);
	});

	test("batchGet: WHERE id = ANY($1)", async () => {
		const userId = randomId();
		const c1 = await repo.create({ userId });
		const c2 = await repo.create({ userId });

		const results = await repo.get([c1.accountConfigId, c2.accountConfigId]);
		assert.equal(results.length, 2);

		await repo.deleteMany([c1.accountConfigId, c2.accountConfigId]);
	});

	test("batchGet empty array returns []", async () => {
		const results = await repo.get([]);
		assert.deepEqual(results, []);
	});

	test("get throws for missing config", async () => {
		await assert.rejects(repo.get(randomId()), /not found/i);
	});

	test("describe assembles collection (accountConfig + account + address)", async () => {
		const userId = randomId();
		const cfg = await repo.create({ userId });

		const accountRepo = new AccountRepo(db as never);
		const addrRepo = new AddressRepo(db as never);

		await accountRepo.create({
			accountConfigId: cfg.accountConfigId,
			username: "u",
			email: "u@test.com",
			isActive: true,
			imapHost: "imap.test.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			connectionState: "not_authenticated",
		});

		await addrRepo.createAddress({
			addressId: randomId(),
			accountConfigId: cfg.accountConfigId,
			localPart: "u",
			domain: "test.com",
			normalizedEmail: "u@test.com",
			normalizedCompound: "u@test.com:u",
		});

		const desc = await repo.describe(cfg.accountConfigId);
		assert.equal(desc.accountConfig.length, 1);
		assert.equal(desc.account.length, 1);
		assert.equal(desc.address.length, 1);

		await repo.delete(cfg.accountConfigId);
	});

	test("listAll returns all configs", async () => {
		const userId = randomId();
		const c1 = await repo.create({ userId });
		const c2 = await repo.create({ userId });

		const all = await repo.listAll();
		const ids = new Set(all.map((c) => c.accountConfigId));
		assert.ok(ids.has(c1.accountConfigId));
		assert.ok(ids.has(c2.accountConfigId));

		await repo.deleteMany([c1.accountConfigId, c2.accountConfigId]);
	});
});
