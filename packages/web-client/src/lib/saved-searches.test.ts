import assert from "node:assert";
import { beforeEach, describe, test } from "node:test";
import {
	isSearchSaved,
	loadSavedSearches,
	removeSavedSearch,
	saveSearch,
} from "./saved-searches.js";

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

describe("saved-searches", () => {
	beforeEach(installMemoryStorage);

	test("starts empty", () => {
		assert.deepEqual(loadSavedSearches(), []);
	});

	test("saves and loads a query", () => {
		assert.deepEqual(saveSearch("from:alice has:attachment"), [
			"from:alice has:attachment",
		]);
		assert.deepEqual(loadSavedSearches(), ["from:alice has:attachment"]);
	});

	test("most recent save first, deduplicated", () => {
		saveSearch("alice");
		saveSearch("bob");
		assert.deepEqual(saveSearch("alice"), ["alice", "bob"]);
	});

	test("ignores blank queries", () => {
		saveSearch("alice");
		assert.deepEqual(saveSearch("   "), ["alice"]);
	});

	test("trims before storing", () => {
		assert.deepEqual(saveSearch("  bob  "), ["bob"]);
	});

	test("survives corrupt storage", () => {
		globalThis.localStorage.setItem("remit.savedSearches", "{not json");
		assert.deepEqual(loadSavedSearches(), []);
	});

	test("removeSavedSearch drops the exact query", () => {
		saveSearch("alice");
		saveSearch("bob");
		assert.deepEqual(removeSavedSearch("alice"), ["bob"]);
		assert.deepEqual(loadSavedSearches(), ["bob"]);
	});

	test("removeSavedSearch is a no-op for a query that isn't saved", () => {
		saveSearch("alice");
		assert.deepEqual(removeSavedSearch("nonexistent"), ["alice"]);
	});

	test("isSearchSaved reflects the persisted set, trimmed", () => {
		saveSearch("alice");
		assert.equal(isSearchSaved("alice"), true);
		assert.equal(isSearchSaved("  alice  "), true);
		assert.equal(isSearchSaved("bob"), false);
	});

	test("caps at MAX_SAVED entries", () => {
		for (let i = 0; i < 30; i++) saveSearch(`query-${i}`);
		assert.equal(loadSavedSearches().length, 25);
		assert.deepEqual(loadSavedSearches()[0], "query-29");
	});
});
