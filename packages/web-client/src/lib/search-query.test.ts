import assert from "node:assert";
import { describe, test } from "node:test";
import { normalizeSearchQuery } from "./search-query.js";

describe("normalizeSearchQuery", () => {
	test("lowercases an ASCII query", () => {
		assert.equal(normalizeSearchQuery("ALICE"), "alice");
	});

	test("trims surrounding whitespace", () => {
		assert.equal(normalizeSearchQuery("   Bob  "), "bob");
	});

	test("returns an empty string for whitespace-only input", () => {
		assert.equal(normalizeSearchQuery("   "), "");
	});

	test("handles non-ASCII letters via locale-aware lowercasing", () => {
		// `toLocaleLowerCase` folds these where `String.prototype.toLowerCase`
		// would also work for Latin-1, but we exercise it to lock the contract.
		assert.equal(normalizeSearchQuery("ÄPPEL"), "äppel");
		assert.equal(normalizeSearchQuery("STRAẞE"), "straße");
	});
});
