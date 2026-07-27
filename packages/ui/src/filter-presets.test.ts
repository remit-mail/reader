import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	briefFilterConfig,
	type FilterAccount,
	flaggedFilterConfig,
	inboxFilterConfig,
	UNCLASSIFIED_CATEGORY,
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

	it("offers the BriefSections chip set", () => {
		assert.deepEqual(
			briefFilterConfig().filters.map((f) => f.id),
			["unread", "attachment", "contacts", "today"],
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

	it("adds Has attachment to Unread and Starred", () => {
		assert.deepEqual(
			inboxFilterConfig().filters.map((f) => f.id),
			["unread", "flagged", "attachment"],
		);
	});

	it("labels the IMAP \\Flagged filter 'Starred'", () => {
		assert.deepEqual(
			inboxFilterConfig().filters.map((f) => f.label),
			["Unread", "Starred", "Has attachment"],
		);
	});

	it("never offers an accounts source group", () => {
		assert.equal(inboxFilterConfig().sources, undefined);
	});
});

describe("flaggedFilterConfig", () => {
	it("offers the same message categories as the brief", () => {
		assert.deepEqual(
			flaggedFilterConfig().categories.map((c) => c.id),
			briefFilterConfig().categories.map((c) => c.id),
		);
	});

	it("offers Unread and Has attachment, never the redundant Flagged", () => {
		assert.deepEqual(
			flaggedFilterConfig().filters.map((f) => f.id),
			["unread", "attachment"],
		);
	});

	it("never offers an accounts source group", () => {
		assert.equal(flaggedFilterConfig().sources, undefined);
	});
});

describe("UNCLASSIFIED_CATEGORY", () => {
	it("is held out of every shipped preset until the server filters it", () => {
		for (const preset of [
			briefFilterConfig(),
			inboxFilterConfig(),
			flaggedFilterConfig(),
		]) {
			assert.equal(
				preset.categories.some((c) => c.id === UNCLASSIFIED_CATEGORY.id),
				false,
			);
		}
	});

	it("carries its own label and tone, never personal's (#45)", () => {
		const personal = briefFilterConfig().categories.find(
			(c) => c.id === "personal",
		);
		assert.equal(UNCLASSIFIED_CATEGORY.label, "Unclassified");
		assert.notEqual(UNCLASSIFIED_CATEGORY.label, personal?.label);
		assert.notEqual(UNCLASSIFIED_CATEGORY.tone, personal?.tone);
	});
});
