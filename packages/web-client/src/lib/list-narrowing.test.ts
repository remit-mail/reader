import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { narrowingLabel } from "./list-narrowing.js";
import { parseSearchTokens, type SearchToken } from "./search-tokens.js";

const chips = (
	category = "all",
	attributes: string[] = [],
): { category: string; attributes: ReadonlySet<string> } => ({
	category,
	attributes: new Set(attributes),
});

const tokensOf = (query: string): SearchToken[] =>
	parseSearchTokens(query).tokens;

describe("narrowingLabel", () => {
	it("says nothing when nothing narrows the list", () => {
		assert.equal(narrowingLabel(chips(), []), undefined);
	});

	it("treats free text as no narrowing — the search copy already names it", () => {
		assert.equal(narrowingLabel(chips(), tokensOf("invoice")), undefined);
	});

	it("names the category chip exactly as it always did", () => {
		assert.equal(narrowingLabel(chips("personal"), []), "Personal mail");
	});

	it("names an attribute chip with no category chosen (#1126)", () => {
		assert.equal(narrowingLabel(chips("all", ["unread"]), []), "unread mail");
		assert.equal(
			narrowingLabel(chips("all", ["attachment"]), []),
			"mail with an attachment",
		);
	});

	it("names a token-only search (#1126)", () => {
		assert.equal(narrowingLabel(chips(), tokensOf("is:unread")), "unread mail");
		assert.equal(
			narrowingLabel(chips(), tokensOf("has:attachment")),
			"mail with an attachment",
		);
	});

	it("orders every narrowing into one phrase", () => {
		assert.equal(
			narrowingLabel(chips("personal", ["unread", "attachment"]), []),
			"Personal unread mail with an attachment",
		);
	});

	it("says one narrowing once when a chip and a token agree", () => {
		assert.equal(
			narrowingLabel(chips("all", ["unread"]), tokensOf("is:unread")),
			"unread mail",
		);
	});

	it("lets the chip win where a token contradicts it, as the request does", () => {
		assert.equal(
			narrowingLabel(chips("personal"), tokensOf("category:newsletter")),
			"Personal mail",
		);
		assert.equal(
			narrowingLabel(chips("all", ["unread"]), tokensOf("is:read")),
			"unread mail",
		);
	});

	it("names the tokens no request parameter carries", () => {
		assert.equal(
			narrowingLabel(chips(), tokensOf("before:2024-01-01")),
			"mail sent before 2024-01-01",
		);
		assert.equal(
			narrowingLabel(chips(), tokensOf("from:alex@example.com")),
			"mail from alex@example.com",
		);
	});

	it("keeps two values of the same token, which narrow to neither one", () => {
		assert.equal(
			narrowingLabel(chips(), tokensOf("from:alex from:priya")),
			"mail from alex from priya",
		);
	});
});
