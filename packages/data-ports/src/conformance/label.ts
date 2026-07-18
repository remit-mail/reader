import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { LabelColor } from "@remit/domain-enums";
import type { ILabelRepository } from "../interfaces/label.js";
import type { RepositoryConformanceHarness } from "./harness.js";

export function labelRepositoryConformance(
	harness: RepositoryConformanceHarness<ILabelRepository>,
): void {
	describe("ILabelRepository conformance", () => {
		let repo: ILabelRepository;

		before(async () => {
			repo = await harness.createRepository();
		});

		after(() => harness.teardown());

		test("create derives normalizedName and defaults color", async () => {
			const accountConfigId = harness.makeId();

			const label = await repo.create({
				accountConfigId,
				name: "  Receipts  ",
			});

			assert.equal(label.name, "  Receipts  ");
			assert.equal(label.normalizedName, "receipts");
			assert.equal(label.color, LabelColor.Default);
		});

		test("get throws a not-found error for a missing label", async () => {
			await assert.rejects(
				repo.get(harness.makeId(), harness.makeId()),
				(error) => harness.isNotFoundError(error),
			);
		});

		test("update re-derives normalizedName when the name changes", async () => {
			const accountConfigId = harness.makeId();
			const label = await repo.create({ accountConfigId, name: "Old Name" });

			const updated = await repo.update(accountConfigId, label.labelId, {
				name: "New Name",
			});

			assert.equal(updated.name, "New Name");
			assert.equal(updated.normalizedName, "new name");
		});

		test("update throws a not-found error for a missing label", async () => {
			await assert.rejects(
				repo.update(harness.makeId(), harness.makeId(), { name: "x" }),
				(error) => harness.isNotFoundError(error),
			);
		});

		test("listByAccountConfig scopes to the account", async () => {
			const accountConfigId = harness.makeId();
			const other = harness.makeId();

			const mine = await repo.create({ accountConfigId, name: "Mine" });
			await repo.create({ accountConfigId: other, name: "Foreign" });

			const labels = await repo.listByAccountConfig(accountConfigId);
			assert.equal(labels.length, 1);
			assert.equal(labels[0]?.labelId, mine.labelId);
		});

		test("findByNormalizedName dedupes case- and whitespace-insensitively", async () => {
			const accountConfigId = harness.makeId();
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
			const accountConfigId = harness.makeId();
			const label = await repo.create({ accountConfigId, name: "Gone" });

			await repo.delete(accountConfigId, label.labelId);

			await assert.rejects(repo.get(accountConfigId, label.labelId), (error) =>
				harness.isNotFoundError(error),
			);
		});
	});
}
