import assert from "node:assert";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
	isFolderSectionCollapsed,
	setFolderSectionCollapsed,
} from "./folder-section-state.js";

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

describe("folder-section-state", () => {
	beforeEach(() => {
		installMemoryStorage();
	});

	afterEach(() => {
		(globalThis as { localStorage?: Storage }).localStorage = undefined;
	});

	test("defaults to collapsed when nothing is stored", () => {
		assert.equal(isFolderSectionCollapsed("acct-1"), true);
	});

	test("round-trips an expanded state", () => {
		setFolderSectionCollapsed("acct-1", false);
		assert.equal(isFolderSectionCollapsed("acct-1"), false);
	});

	test("round-trips a collapsed state", () => {
		setFolderSectionCollapsed("acct-1", false);
		setFolderSectionCollapsed("acct-1", true);
		assert.equal(isFolderSectionCollapsed("acct-1"), true);
	});

	test("state is keyed per account", () => {
		setFolderSectionCollapsed("acct-1", false);
		assert.equal(isFolderSectionCollapsed("acct-1"), false);
		assert.equal(isFolderSectionCollapsed("acct-2"), true);
	});

	test("treats a missing localStorage as collapsed", () => {
		(globalThis as { localStorage?: Storage }).localStorage = undefined;
		assert.equal(isFolderSectionCollapsed("acct-1"), true);
	});
});
