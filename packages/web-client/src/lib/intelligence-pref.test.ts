import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	readIntelligencePref,
	writeIntelligencePref,
} from "./intelligence-pref.js";

const installMemoryStorage = (): void => {
	const store = new Map<string, string>();
	(globalThis as { localStorage?: Storage }).localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	} as Storage;
};

describe("intelligence-pref (#782)", () => {
	beforeEach(() => {
		installMemoryStorage();
	});

	afterEach(() => {
		(globalThis as { localStorage?: Storage }).localStorage = undefined;
	});

	it("defaults to open when nothing is stored", () => {
		assert.equal(readIntelligencePref(), true);
	});

	it("honours a stored collapse", () => {
		writeIntelligencePref(false);
		assert.equal(readIntelligencePref(), false);
	});

	it("round-trips an explicit open", () => {
		writeIntelligencePref(false);
		writeIntelligencePref(true);
		assert.equal(readIntelligencePref(), true);
	});

	it("falls back to open when storage is unavailable", () => {
		(globalThis as { localStorage?: Storage }).localStorage = undefined;
		assert.equal(readIntelligencePref(), true);
		assert.doesNotThrow(() => writeIntelligencePref(false));
	});
});
