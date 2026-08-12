import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	readIntelligencePref,
	resolveRailOpen,
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

describe("resolveRailOpen (#722)", () => {
	it("opens the rail with the thread where the address says nothing", () => {
		assert.equal(
			resolveRailOpen({ panels: [], prefersOpen: true, isDesktop: true }),
			true,
		);
	});

	it("leaves the rail down where the address says nothing and the reader collapsed it", () => {
		assert.equal(
			resolveRailOpen({ panels: [], prefersOpen: false, isDesktop: true }),
			false,
		);
	});

	it("never seeds the rail below the tier that has one", () => {
		assert.equal(
			resolveRailOpen({ panels: [], prefersOpen: true, isDesktop: false }),
			false,
		);
	});

	// A shared link naming another panel is an address that has spoken: the
	// recipient's own preference does not get to add the rail to it.
	it("hands a shared link's panels to the reader who opened it", () => {
		assert.equal(
			resolveRailOpen({
				panels: ["shortcuts"],
				prefersOpen: true,
				isDesktop: true,
			}),
			false,
		);
		assert.equal(
			resolveRailOpen({
				panels: ["intelligence", "shortcuts"],
				prefersOpen: false,
				isDesktop: true,
			}),
			true,
		);
	});

	it("opens the rail from an address on any tier", () => {
		assert.equal(
			resolveRailOpen({
				panels: ["intelligence"],
				prefersOpen: false,
				isDesktop: false,
			}),
			true,
		);
	});
});
