// Regression test for #623: search results must be openable once the query
// settles. The route computes `isSearchPending = searchInput !== searchQuery`
// to decide whether to suppress the reading pane, then resolves the selected
// thread via `resolveSelectedThread`.
//
// - `searchInput` is the live (pre-debounce) value the user is typing.
// - `searchQuery` is the debounced (committed) value sent to the API.
// - The pane is suppressed only while the two differ (a debounce is in flight).
// - Once settled, a selected result should be shown in the reading pane.

import assert from "node:assert";
import { describe, test } from "node:test";
import { isSearchPending, resolveSelectedThread } from "./search-pending.ts";

describe("isSearchPending (reading-pane suppression guard)", () => {
	test("no search: both empty — not pending", () => {
		assert.equal(isSearchPending("", ""), false);
	});

	test("settled search: input matches debounced query — not pending", () => {
		assert.equal(isSearchPending("amazon", "amazon"), false);
	});

	test("user starts typing: input differs from query — pending", () => {
		assert.equal(isSearchPending("ama", ""), true);
	});

	test("mid-debounce: partial input vs previous query — pending", () => {
		assert.equal(isSearchPending("amaz", "amazon"), true);
	});
});

describe("resolveSelectedThread (#623 reading-pane resolution)", () => {
	const threads = [{ messageId: "msg-001" }, { messageId: "msg-002" }];

	test("regression #623: settled query with a matching selection opens the thread", () => {
		const pending = isSearchPending("amazon", "amazon");
		assert.equal(pending, false);

		const selectedThread = resolveSelectedThread(threads, "msg-001", pending);
		assert.deepEqual(selectedThread, { messageId: "msg-001" });
	});

	test("pending search suppresses the reading pane even with a matching selection", () => {
		const pending = isSearchPending("amaz", "amazon");
		assert.equal(pending, true);

		const selectedThread = resolveSelectedThread(threads, "msg-001", pending);
		assert.equal(selectedThread, undefined);
	});

	test("settled query but selection absent from results — no thread", () => {
		const selectedThread = resolveSelectedThread(threads, "msg-999", false);
		assert.equal(selectedThread, undefined);
	});

	test("settled query with no selection — no thread", () => {
		const selectedThread = resolveSelectedThread(threads, undefined, false);
		assert.equal(selectedThread, undefined);
	});
});
