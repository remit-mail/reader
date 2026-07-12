import assert from "node:assert";
import { after, before, describe, test } from "node:test";
import { LabelColor } from "@remit/domain-enums";
import { NotFoundError } from "../error.js";
import { createTestDb, randomId, type TestDb } from "../test-db.js";
import { LabelRepo } from "./label.js";

describe("LabelRepo", () => {
	let db: TestDb;
	let close: () => Promise<void>;
	let repo: LabelRepo;

	before(async () => {
		({ db, close } = await createTestDb());
		repo = new LabelRepo(db as never);
	});

	after(async () => {
		await close();
	});

	test("create derives normalizedName and defaults color", async () => {
		const accountConfigId = randomId();
		const label = await repo.create({
			accountConfigId,
			name: "  Receipts  ",
		});

		assert.equal(label.name, "  Receipts  ");
		assert.equal(label.normalizedName, "receipts");
		assert.equal(label.color, LabelColor.Default);
	});

	test("get throws NotFoundError for a missing label", async () => {
		await assert.rejects(repo.get(randomId(), randomId()), NotFoundError);
	});

	test("update re-derives normalizedName when name changes", async () => {
		const accountConfigId = randomId();
		const label = await repo.create({ accountConfigId, name: "Old Name" });

		const updated = await repo.update(accountConfigId, label.labelId, {
			name: "New Name",
		});

		assert.equal(updated.name, "New Name");
		assert.equal(updated.normalizedName, "new name");
	});

	test("update throws NotFoundError for a missing label", async () => {
		await assert.rejects(
			repo.update(randomId(), randomId(), { name: "x" }),
			NotFoundError,
		);
	});

	test("listByAccountConfig scopes to the account", async () => {
		const accountConfigId = randomId();
		const other = randomId();

		const mine = await repo.create({ accountConfigId, name: "Mine" });
		await repo.create({ accountConfigId: other, name: "Foreign" });

		const labels = await repo.listByAccountConfig(accountConfigId);
		assert.equal(labels.length, 1);
		assert.equal(labels[0]?.labelId, mine.labelId);
	});

	test("findByNormalizedName dedupes case/whitespace-insensitively", async () => {
		const accountConfigId = randomId();
		const label = await repo.create({ accountConfigId, name: "Work" });

		const found = await repo.findByNormalizedName(accountConfigId, "WORK");
		assert.equal(found?.labelId, label.labelId);

		const missing = await repo.findByNormalizedName(
			accountConfigId,
			"nonexistent",
		);
		assert.equal(missing, null);
	});

	test("delete removes the row", async () => {
		const accountConfigId = randomId();
		const label = await repo.create({ accountConfigId, name: "Gone" });

		await repo.delete(accountConfigId, label.labelId);

		await assert.rejects(
			repo.get(accountConfigId, label.labelId),
			NotFoundError,
		);
	});
});
