import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	briefFilterConfig,
	type FilterAccount,
	inboxFilterConfig,
} from "./filter-presets.js";

const accounts: FilterAccount[] = [
	{ id: "all", label: "All", active: true },
	{ id: "personal", label: "Personal", count: 9 },
	{ id: "work", label: "Work", count: 14 },
];

describe("briefFilterConfig", () => {
	it("offers the message categories with a leading All", () => {
		const { categories } = briefFilterConfig();
		assert.equal(categories[0]?.id, "all");
		assert.deepEqual(
			categories.map((c) => c.id),
			[
				"all",
				"personal",
				"transactional",
				"newsletter",
				"marketing",
				"social",
				"automated",
			],
		);
	});

	it("offers Unread and Flagged only", () => {
		assert.deepEqual(
			briefFilterConfig().filters.map((f) => f.id),
			["unread", "flagged"],
		);
	});

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

describe("inboxFilterConfig", () => {
	it("offers the same message categories as the brief", () => {
		assert.deepEqual(
			inboxFilterConfig().categories.map((c) => c.id),
			briefFilterConfig().categories.map((c) => c.id),
		);
	});

	it("adds Has attachment to Unread and Flagged", () => {
		assert.deepEqual(
			inboxFilterConfig().filters.map((f) => f.id),
			["unread", "flagged", "attachment"],
		);
	});

	it("never offers an accounts source group", () => {
		assert.equal(inboxFilterConfig().sources, undefined);
	});
});
