import assert from "node:assert";
import { beforeEach, describe, test } from "node:test";
import { loadRecentSearches, saveRecentSearch } from "./recent-searches.js";

function installMemoryStorage(): void {
	const store = new Map<string, string>();
	globalThis.localStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear(),
		key: () => null,
		length: 0,
	} as Storage;
}

describe("recent-searches", () => {
	beforeEach(installMemoryStorage);

	test("starts empty", () => {
		assert.deepEqual(loadRecentSearches(), []);
	});

	test("saves and loads a query", () => {
		assert.deepEqual(saveRecentSearch("alice"), ["alice"]);
		assert.deepEqual(loadRecentSearches(), ["alice"]);
	});

	test("most recent first, deduplicated", () => {
		saveRecentSearch("alice");
		saveRecentSearch("bob");
		assert.deepEqual(saveRecentSearch("alice"), ["alice", "bob"]);
	});

	test("caps at five entries", () => {
		for (const q of ["a", "b", "c", "d", "e", "f"]) saveRecentSearch(q);
		assert.deepEqual(loadRecentSearches(), ["f", "e", "d", "c", "b"]);
	});

	test("ignores blank queries", () => {
		saveRecentSearch("alice");
		assert.deepEqual(saveRecentSearch("   "), ["alice"]);
	});

	test("trims before storing", () => {
		assert.deepEqual(saveRecentSearch("  bob  "), ["bob"]);
	});

	test("survives corrupt storage", () => {
		globalThis.localStorage.setItem("remit.recentSearches", "{not json");
		assert.deepEqual(loadRecentSearches(), []);
	});
});
