import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { AccountSettingRepo } from "./i4-account-setting.js";

describe("AccountSettingRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: AccountSettingRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new AccountSettingRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("upsert and get", async () => {
		const accountConfigId = randomId();
		await repo.upsert({
			accountConfigId,
			name: "Theme",
			value: { kind: "String", value: "dark" },
		});

		const setting = await repo.get(accountConfigId, "Theme");
		assert.ok(setting);
		assert.equal(setting.name, "Theme");
		assert.deepEqual(setting.value, { kind: "String", value: "dark" });

		await repo.delete(accountConfigId, "Theme");
	});

	test("upsert is idempotent (overwrites)", async () => {
		const accountConfigId = randomId();
		await repo.upsert({
			accountConfigId,
			name: "Density",
			value: { kind: "String", value: "compact" },
		});
		await repo.upsert({
			accountConfigId,
			name: "Density",
			value: { kind: "String", value: "comfortable" },
		});

		const setting = await repo.get(accountConfigId, "Density");
		assert.deepEqual(setting?.value, { kind: "String", value: "comfortable" });

		await repo.delete(accountConfigId, "Density");
	});

	test("get returns null when setting absent", async () => {
		const setting = await repo.get(randomId(), "Theme");
		assert.equal(setting, null);
	});

	test("listByAccountConfig returns all settings ordered by name", async () => {
		const accountConfigId = randomId();
		await repo.upsert({
			accountConfigId,
			name: "Theme",
			value: { kind: "String", value: "dark" },
		});
		await repo.upsert({
			accountConfigId,
			name: "Density",
			value: { kind: "String", value: "compact" },
		});

		const settings = await repo.listByAccountConfig(accountConfigId);
		assert.equal(settings.length, 2);
		assert.equal(settings[0].name, "Density");
		assert.equal(settings[1].name, "Theme");

		await repo.delete(accountConfigId, "Theme");
		await repo.delete(accountConfigId, "Density");
	});

	test("delete removes the setting", async () => {
		const accountConfigId = randomId();
		await repo.upsert({
			accountConfigId,
			name: "Theme",
			value: { kind: "Boolean", value: true },
		});
		await repo.delete(accountConfigId, "Theme");

		const setting = await repo.get(accountConfigId, "Theme");
		assert.equal(setting, null);
	});
});
