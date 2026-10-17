import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { briefFilterConfig, type FilterAccount } from "./filter-presets.js";

const accounts: FilterAccount[] = [
	{ id: "all", label: "All", active: true },
	{ id: "personal", label: "Personal", count: 9 },
	{ id: "work", label: "Work", count: 14 },
];

describe("briefFilterConfig", () => {
	it("includes the accounts source group when more than one account", () => {
		const { sources } = briefFilterConfig(accounts);
		assert.deepEqual(
			sources?.map((s) => s.id),
			["all", "personal", "work"],
		);
	});

	it("omits the accounts source group for a single account", () => {
		assert.equal(briefFilterConfig(accounts.slice(0, 1)).sources, undefined);
		assert.equal(briefFilterConfig().sources, undefined);
	});
});
