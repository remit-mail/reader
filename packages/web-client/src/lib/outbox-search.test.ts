import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesOutboxSearch } from "./outbox-search";

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
});
