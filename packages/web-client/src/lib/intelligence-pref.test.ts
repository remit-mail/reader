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
	const OPEN_MESSAGE = "thread-1/msg-1";
	// No raise live, and a message on screen for one to be measured against.
	const unraised = { raisedFor: null, openMessage: OPEN_MESSAGE };
	const withThread = { hasThread: true, isDesktop: true, ...unraised };

	it("opens the rail with the thread where the address says nothing", () => {
		assert.equal(
			resolveRailOpen({ ...withThread, panels: [], prefersOpen: true }),
			true,
		);
	});

	it("leaves the rail down where the address says nothing and the reader collapsed it", () => {
		assert.equal(
			resolveRailOpen({ ...withThread, panels: [], prefersOpen: false }),
			false,
		);
	});

	it("never seeds the rail below the tier that has one", () => {
		assert.equal(
			resolveRailOpen({
				panels: [],
				prefersOpen: true,
				isDesktop: false,
				hasThread: true,
				...unraised,
			}),
			false,
		);
	});

	// Otherwise the address claims a pane the shell has nothing to put in it.
	it("never seeds the rail with no conversation open", () => {
		assert.equal(
			resolveRailOpen({
				panels: [],
				prefersOpen: true,
				isDesktop: true,
				hasThread: false,
				...unraised,
			}),
			false,
		);
	});

	// A shared link naming another panel is an address that has spoken: the
	// recipient's own preference does not get to add the rail to it.
	it("hands a shared link's panels to the reader who opened it", () => {
		assert.equal(
			resolveRailOpen({
				...withThread,
				panels: ["shortcuts"],
				prefersOpen: true,
			}),
			false,
		);
		assert.equal(
			resolveRailOpen({
				...withThread,
				panels: ["intelligence", "shortcuts"],
				prefersOpen: false,
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
				hasThread: true,
				...unraised,
			}),
			true,
		);
	});
});

/**
 * A DKIM mismatch, or the banner's "Why?", puts the rail up for the message the
 * reader is looking at. It is measured against that message rather than stored,
 * so it reaches neither the address nor the preference, and the next thread the
 * reader opens is not carrying it (#778).
 */
describe("a raised rail belongs to its message (#778)", () => {
	const OPEN_MESSAGE = "thread-1/msg-1";
	const collapsed = {
		hasThread: true,
		isDesktop: true,
		panels: [] as const,
		prefersOpen: false,
	};

	it("puts the rail up over a collapse for the message it was raised for", () => {
		assert.equal(
			resolveRailOpen({
				...collapsed,
				raisedFor: OPEN_MESSAGE,
				openMessage: OPEN_MESSAGE,
			}),
			true,
		);
	});

	it("ends with the message, so the next thread opens as the reader left it", () => {
		assert.equal(
			resolveRailOpen({
				...collapsed,
				raisedFor: OPEN_MESSAGE,
				openMessage: "thread-2/msg-2",
			}),
			false,
		);
		assert.equal(
			resolveRailOpen({
				...collapsed,
				hasThread: false,
				raisedFor: OPEN_MESSAGE,
				openMessage: null,
			}),
			false,
		);
	});

	// The reader is being shown something about the message in front of them, so
	// a link that named other panels does not get to suppress it.
	it("surfaces over an address that named another panel", () => {
		assert.equal(
			resolveRailOpen({
				...collapsed,
				panels: ["shortcuts"],
				raisedFor: OPEN_MESSAGE,
				openMessage: OPEN_MESSAGE,
			}),
			true,
		);
	});
});
