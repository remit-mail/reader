import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesOutboxSearch, outboxQueryIsUnsupported } from "./outbox-search";
import { parseSearchTokens } from "./search-tokens";

const row = {
	subject: "Q3 Invoice",
	fromAddress: "me@example.com",
	fromName: "Me",
	toAddresses: ["billing@acme.test"],
	ccAddresses: ["accounts@acme.test"],
};

describe("matchesOutboxSearch", () => {
	it("keeps every row when there is no query", () => {
		assert.equal(matchesOutboxSearch(row, "   "), true);
	});

	it("matches the subject", () => {
		assert.equal(matchesOutboxSearch(row, "invoice"), true);
	});

	it("matches a recipient", () => {
		assert.equal(matchesOutboxSearch(row, "acme"), true);
	});

	it("matches the sender", () => {
		assert.equal(matchesOutboxSearch(row, "me@example"), true);
	});

	it("requires every word, in any order and any field", () => {
		assert.equal(matchesOutboxSearch(row, "invoice billing"), true);
		assert.equal(matchesOutboxSearch(row, "invoice missing"), false);
	});

	it("drops a row that matches nothing", () => {
		assert.equal(matchesOutboxSearch(row, "receipt"), false);
	});

	it("tolerates rows with absent fields", () => {
		assert.equal(matchesOutboxSearch({}, "anything"), false);
		assert.equal(matchesOutboxSearch({}, ""), true);
	});

	it("matches the free text of a query that also carries a token", () => {
		// The token is dropped, but what the user typed alongside it still
		// searches — the row is not lost to an operator the outbox can't serve.
		const { freeText } = parseSearchTokens("Q3 from:billing");
		assert.equal(matchesOutboxSearch(row, freeText), true);
	});
});

describe("outboxQueryIsUnsupported", () => {
	it("is true for a query that is only tokens", () => {
		assert.equal(
			outboxQueryIsUnsupported(parseSearchTokens("from:billing")),
			true,
		);
	});

	it("is false when free text survives the parse", () => {
		assert.equal(
			outboxQueryIsUnsupported(parseSearchTokens("Q3 from:billing")),
			false,
		);
	});

	it("is false for plain free text", () => {
		assert.equal(outboxQueryIsUnsupported(parseSearchTokens("invoice")), false);
	});

	it("is false for an empty query", () => {
		assert.equal(outboxQueryIsUnsupported(parseSearchTokens("")), false);
	});
});
