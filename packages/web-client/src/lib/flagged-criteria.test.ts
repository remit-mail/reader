/**
 * What the Flagged view asks the server for.
 *
 * #308: the chips became query parameters, and the tokens that ask for the same
 * thing have to travel the same way. A token evaluated over the pages loaded so
 * far reintroduces the defect one control down — the field would show an empty
 * list for a category whose starred mail sits below the newest page, while the
 * chip beside it showed the mail.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flaggedCriteria } from "./flagged-criteria.js";
import type { InboxFilterCriteria } from "./inbox-filters.js";
import { parseSearchTokens, type SearchToken } from "./search-tokens.js";

const NO_CHIPS: InboxFilterCriteria = {
	category: "all",
	attributes: new Set<string>(),
};

const chips = (
	category: string,
	attributes: string[] = [],
): InboxFilterCriteria => ({ category, attributes: new Set(attributes) });

const tokensOf = (query: string): SearchToken[] =>
	parseSearchTokens(query, {
		accountsByName: new Map([["alice", "acc_1"]]),
		mailboxesByName: new Map([["sent", "mb2"]]),
	}).tokens;

const criteriaOf = (query: string, filters = NO_CHIPS) =>
	flaggedCriteria(filters, tokensOf(query)).criteria;

const residualTypes = (query: string, filters = NO_CHIPS) =>
	flaggedCriteria(filters, tokensOf(query)).residual.map((t) => t.type);

describe("flaggedCriteria", () => {
	test("a typed token asks for exactly what its chip asks for", () => {
		assert.deepEqual(
			criteriaOf("is:unread"),
			criteriaOf("", chips("all", ["unread"])),
		);
		assert.deepEqual(
			criteriaOf("has:attachment"),
			criteriaOf("", chips("all", ["attachment"])),
		);
		assert.deepEqual(
			criteriaOf("category:personal"),
			criteriaOf("", chips("personal")),
		);
	});

	test("carries the row criteria as parameters", () => {
		assert.deepEqual(criteriaOf("is:unread"), { unread: true });
		assert.deepEqual(criteriaOf("is:read"), { unread: false });
		assert.deepEqual(criteriaOf("has:attachment"), { attachments: true });
		assert.deepEqual(criteriaOf("category:social"), { category: ["social"] });
	});

	test("leaves nothing carried in the residue", () => {
		assert.deepEqual(
			residualTypes("is:unread has:attachment category:personal"),
			[],
		);
	});

	// The view is starred mail, so the request always carries `starred`. A token
	// asking for what the request already asks for is answered, not re-applied.
	test("answers is:starred from the view itself", () => {
		assert.deepEqual(residualTypes("is:starred"), []);
	});

	// #1128: the free-text parameter matches subject and From at once, so
	// neither token could be asked for on its own. Both applied over the pages
	// already fetched, and a starred collection is paged — a match below them
	// never appeared. Each has its own parameter now.
	test("from: and subject: travel as parameters", () => {
		assert.deepEqual(criteriaOf("from:alice"), { from: "alice" });
		assert.deepEqual(residualTypes("from:alice"), []);
		assert.deepEqual(criteriaOf("subject:invoice"), { subject: "invoice" });
		assert.deepEqual(residualTypes("subject:invoice"), []);
	});

	test("keeps the tokens no parameter carries", () => {
		assert.deepEqual(residualTypes("before:2026-01-01"), ["before"]);
		assert.deepEqual(residualTypes("in:sent"), ["in"]);
		assert.deepEqual(residualTypes("account:alice"), ["account"]);
	});

	// One parameter per field, so only the first value can be expressed.
	test("a second subject: stays residue", () => {
		assert.deepEqual(criteriaOf("subject:one subject:two"), {
			subject: "one",
		});
		assert.deepEqual(residualTypes("subject:one subject:two"), ["subject"]);
	});

	test("the chip wins over a token that contradicts it", () => {
		const { criteria, residual } = flaggedCriteria(
			chips("all", ["unread"]),
			tokensOf("is:read"),
		);
		assert.equal(criteria.unread, true);
		assert.deepEqual(
			residual.map((t) => t.type),
			["isRead"],
		);
	});

	test("a cleared category sets no category parameter", () => {
		assert.deepEqual(criteriaOf("", NO_CHIPS), {});
	});
});
