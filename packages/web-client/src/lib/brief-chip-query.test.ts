import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ThreadRowData } from "@remit/ui";
import {
	briefQueryCategory,
	briefQueryFilters,
	setBriefCategoryInQuery,
	toggleBriefFilterInQuery,
} from "@remit/ui";
import { matchesSearchTokens } from "./brief.js";
import { parseSearchTokens } from "./search-tokens.js";

/**
 * The brief's chips and the token parser read one query, and this checks them
 * against each other rather than against a second copy of either: a chip may
 * only read ticked for a facet the parser actually applies, and a term a chip
 * writes must narrow the rows the parser narrows.
 *
 * The spellings here are the ones a hand-typed query carries and a whitespace
 * splitter got wrong.
 */

const row = (overrides: Partial<ThreadRowData> = {}): ThreadRowData => ({
	id: "m1",
	accountId: "acc_1",
	fromName: "Odido",
	fromEmail: "info@odido.example",
	subject: "Je factuur van juni",
	snippet: "Snippet",
	timeLabel: "09:00",
	isRead: false,
	hasAttachment: false,
	starred: false,
	category: "newsletter",
	...overrides,
});

const applies = (query: string, thread: ThreadRowData): boolean =>
	matchesSearchTokens(thread, parseSearchTokens(query).tokens);

describe("the chips agree with the parser on what a query applies", () => {
	it("leaves a facet spelled inside a quoted value to that value", () => {
		const query = 'subject:"a is:unread b"';
		assert.deepEqual(
			parseSearchTokens(query).tokens.map((token) => token.type),
			["subject"],
		);
		assert.equal(briefQueryFilters(query).has("unread"), false);
	});

	it("ticks the chip for a facet whose own value is quoted", () => {
		const query = 'is:"unread"';
		assert.deepEqual(
			parseSearchTokens(query).tokens.map((token) => token.type),
			["isUnread"],
		);
		assert.equal(briefQueryFilters(query).has("unread"), true);
	});

	it("scopes to the category a quoted value names", () => {
		const query = 'category:"Newsletter"';
		assert.equal(briefQueryCategory(query), "newsletter");
		assert.equal(applies(query, row()), true);
	});
});

describe("a term a chip writes narrows the rows", () => {
	it("hides a read row once Unread is ticked", () => {
		const query = toggleBriefFilterInQuery("Odido", "unread");
		assert.ok(query);
		assert.equal(applies(query, row({ isRead: false })), true);
		assert.equal(applies(query, row({ isRead: true })), false);
	});

	// Facet tokens are ANDed, so a category pill that left the previous term in
	// place matched nothing at all — an empty list one click from a full one.
	it("keeps a category pill from emptying the list it was picked from", () => {
		const query = setBriefCategoryInQuery('category:"Newsletter"', "marketing");
		assert.deepEqual(
			parseSearchTokens(query).tokens.map((token) => token.type),
			["category"],
		);
		assert.equal(applies(query, row({ category: "marketing" })), true);
	});
});
