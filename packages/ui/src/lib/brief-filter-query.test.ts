import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BriefFilterId } from "../components/brief-sections.js";
import {
	briefChipCategory,
	briefChipFilters,
	briefFilterHasTerm,
	briefQueryCategory,
	briefQueryFilters,
	clearBriefFiltersInQuery,
	setBriefCategoryInQuery,
	toggleBriefFilterInQuery,
} from "./brief-filter-query.js";

const ids = (filters: ReadonlySet<BriefFilterId>): BriefFilterId[] =>
	[...filters].sort();

describe("ticking a chip while a search is on", () => {
	it("writes its term into the query, where it can be read", () => {
		assert.equal(
			toggleBriefFilterInQuery("Odido", "unread"),
			"Odido is:unread",
		);
	});

	it("writes the attachment term the same way", () => {
		assert.equal(
			toggleBriefFilterInQuery("Odido", "attachment"),
			"Odido has:attachment",
		);
	});

	it("takes the term back out when the chip is unticked", () => {
		assert.equal(
			toggleBriefFilterInQuery("Odido is:unread", "unread"),
			"Odido",
		);
	});

	it("leaves a chips-only query behind once the words are deleted", () => {
		assert.equal(toggleBriefFilterInQuery("", "unread"), "is:unread");
	});

	it("says a chip has no term rather than writing one that means nothing", () => {
		assert.equal(toggleBriefFilterInQuery("Odido", "contacts"), undefined);
		assert.equal(toggleBriefFilterInQuery("Odido", "today"), undefined);
		assert.equal(briefFilterHasTerm("contacts"), false);
		assert.equal(briefFilterHasTerm("today"), false);
	});
});

describe("scoping to a category while a search is on", () => {
	it("writes the category term", () => {
		assert.equal(
			setBriefCategoryInQuery("Odido", "newsletter"),
			"Odido category:newsletter",
		);
	});

	it("swaps one category for another rather than stacking them", () => {
		assert.equal(
			setBriefCategoryInQuery("Odido category:newsletter", "marketing"),
			"Odido category:marketing",
		);
	});

	it("takes the term out again when the scope goes back to all", () => {
		assert.equal(
			setBriefCategoryInQuery("Odido category:newsletter", "all"),
			"Odido",
		);
	});
});

describe("a term edited or deleted by hand", () => {
	it("ticks the chip it names", () => {
		assert.deepEqual(ids(briefQueryFilters("Odido is:unread")), ["unread"]);
	});

	it("reads the same whatever case it is typed in", () => {
		assert.deepEqual(ids(briefQueryFilters("Odido IS:Unread")), ["unread"]);
	});

	it("unticks the chip once it is deleted", () => {
		assert.deepEqual(ids(briefQueryFilters("Odido")), []);
	});

	it("scopes the category the term names, alias included", () => {
		assert.equal(briefQueryCategory("Odido category:newsletter"), "newsletter");
		assert.equal(
			briefQueryCategory("Odido category:unclassified"),
			"uncategorized",
		);
	});

	it("leaves the scope alone for a category nobody has", () => {
		assert.equal(briefQueryCategory("Odido category:nonsense"), "all");
	});

	it("never reads its own word as a category", () => {
		assert.equal(briefQueryCategory("category:all"), "all");
	});

	it("keeps the words the query is otherwise made of", () => {
		assert.equal(
			clearBriefFiltersInQuery(
				"Odido is:unread category:newsletter from:a@b.c",
			),
			"Odido from:a@b.c",
		);
	});
});

describe("the chips the panel shows ticked", () => {
	it("are the panel's own while nothing is being searched", () => {
		assert.deepEqual(
			ids(briefChipFilters({ query: "", ownFilters: new Set(["unread"]) })),
			["unread"],
		);
		assert.equal(
			briefChipCategory({ query: "", ownCategory: "newsletter" }),
			"newsletter",
		);
	});

	it("are the query's terms while a search is on", () => {
		assert.deepEqual(
			ids(
				briefChipFilters({
					query: "Odido has:attachment",
					ownFilters: new Set(["unread"]),
				}),
			),
			["attachment"],
		);
		assert.equal(
			briefChipCategory({ query: "Odido", ownCategory: "newsletter" }),
			"all",
		);
	});

	it("carry the chips the vocabulary cannot spell across a search", () => {
		assert.deepEqual(
			ids(
				briefChipFilters({
					query: "Odido is:unread",
					ownFilters: new Set(["today", "contacts"]),
				}),
			),
			["contacts", "today", "unread"],
		);
	});
});
