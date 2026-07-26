import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FilterItem, LabelItem } from "@remit/data-ports";
import {
	deleteLabelWithCascade,
	findFiltersForLabel,
	type LabelCrudDeps,
} from "./label.js";

const filter = (filterId: string, actionLabelId: string): FilterItem =>
	({ filterId, actionLabelId }) as unknown as FilterItem;

const label = (labelId: string): LabelItem =>
	({
		labelId,
		accountConfigId: "acc-1",
		name: "x",
		color: "Default",
	}) as LabelItem;

const buildDeps = (filters: FilterItem[]) => {
	const deletedFilterIds: string[] = [];
	const removedLabelIds: string[] = [];
	const deletedLabelIds: string[] = [];

	const deps: LabelCrudDeps = {
		label: {
			create: async () => label("unused"),
			get: async (_accountConfigId: string, labelId: string) => label(labelId),
			update: async (_accountConfigId: string, labelId: string) =>
				label(labelId),
			delete: async (_accountConfigId: string, labelId: string) => {
				deletedLabelIds.push(labelId);
			},
			listPageByAccountConfig: async () => ({
				items: [],
				continuationToken: undefined,
			}),
		},
		filter: {
			listByAccountConfig: async () => filters,
			delete: async (_accountConfigId: string, filterId: string) => {
				deletedFilterIds.push(filterId);
			},
		},
		messageLabel: {
			removeAllByLabelId: async (_accountConfigId: string, labelId: string) => {
				removedLabelIds.push(labelId);
			},
		},
	};

	return { deps, deletedFilterIds, removedLabelIds, deletedLabelIds };
};

describe("findFiltersForLabel", () => {
	test("returns only the filters whose actionLabelId matches", async () => {
		const filters = [
			filter("f1", "label-1"),
			filter("f2", "label-2"),
			filter("f3", "label-1"),
		];
		const { deps } = buildDeps(filters);

		const found = await findFiltersForLabel(deps, "acc-1", "label-1");
		assert.deepEqual(found.map((f) => f.filterId).sort(), ["f1", "f3"]);
	});

	test("returns an empty list when no filter uses the label", async () => {
		const { deps } = buildDeps([filter("f1", "label-2")]);
		const found = await findFiltersForLabel(deps, "acc-1", "label-1");
		assert.deepEqual(found, []);
	});
});

describe("deleteLabelWithCascade", () => {
	test("deletes every filter referencing the label, clears applied messages, then deletes the label", async () => {
		const filters = [
			filter("f1", "label-1"),
			filter("f2", "label-2"),
			filter("f3", "label-1"),
		];
		const { deps, deletedFilterIds, removedLabelIds, deletedLabelIds } =
			buildDeps(filters);

		await deleteLabelWithCascade(deps, "acc-1", "label-1");

		assert.deepEqual(deletedFilterIds.sort(), ["f1", "f3"]);
		assert.deepEqual(removedLabelIds, ["label-1"]);
		assert.deepEqual(deletedLabelIds, ["label-1"]);
	});

	test("never touches a filter that references a different label", async () => {
		const filters = [filter("f1", "label-2")];
		const { deps, deletedFilterIds } = buildDeps(filters);

		await deleteLabelWithCascade(deps, "acc-1", "label-1");

		assert.deepEqual(deletedFilterIds, []);
	});

	test("is a no-op on the filter/messageLabel side when nothing references the label", async () => {
		const { deps, deletedFilterIds, removedLabelIds, deletedLabelIds } =
			buildDeps([]);

		await deleteLabelWithCascade(deps, "acc-1", "label-1");

		assert.deepEqual(deletedFilterIds, []);
		assert.deepEqual(removedLabelIds, ["label-1"]);
		assert.deepEqual(deletedLabelIds, ["label-1"]);
	});
});
