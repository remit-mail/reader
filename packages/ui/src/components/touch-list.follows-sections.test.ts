/**
 * The touch list renders the `sections` it is handed, on every render.
 *
 * It used to copy them into state on mount, so a consumer whose verbs act on
 * its own rows — the selection bar's Trash — cleared the bar and left every
 * row on screen. The swipe mock still has to work, so what it does is held as
 * ids over whatever the consumer passes rather than as a copy of the rows.
 */

import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ThreadSection } from "./app-shell-types.js";
import type { SwipePeek } from "./swipeable-row.js";
import { TouchListBody } from "./touch-list.js";

let container: HTMLElement;
let root: Root;

const row = (id: string, fromName: string, isRead = false) => ({
	id,
	accountId: "account-1",
	fromName,
	fromEmail: `${id}@example.com`,
	subject: `Subject ${id}`,
	snippet: "…",
	timeLabel: "9:42",
	isRead,
});

const sectionsOf = (...ids: string[]): ThreadSection[] => [
	{ id: "inbox", threads: ids.map((id) => row(id, `Sender ${id}`)) },
];

const readOf = (...ids: string[]): ThreadSection[] => [
	{ id: "inbox", threads: ids.map((id) => row(id, `Sender ${id}`, true)) },
];

const render = (sections: ThreadSection[], initialPeek?: SwipePeek) => {
	act(() => {
		root.render(
			createElement(TouchListBody, {
				sections,
				initialPeek,
				selectionMode: false,
				checkedIds: new Set<string>(),
				onToggleCheck: () => undefined,
				onEnterSelection: () => undefined,
				onOpenThread: () => undefined,
				onRefresh: () => undefined,
				refreshing: false,
			}),
		);
	});
};

/** The unread dot each row draws while it is unread, and only then. */
const unreadRows = () =>
	container.querySelectorAll("span.rounded-full.bg-accent").length;

const click = (label: string) => {
	const button = container.querySelector(`button[aria-label="${label}"]`);
	assert.ok(button, `no "${label}" control on the page`);
	act(() => {
		button.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
};

beforeEach(() => {
	container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

describe("TouchListBody", () => {
	it("drops the rows a consumer's verb removed", () => {
		render(sectionsOf("a", "b", "c"));
		assert.match(container.textContent ?? "", /Sender a/);

		render(sectionsOf("c"));
		assert.doesNotMatch(container.textContent ?? "", /Sender a/);
		assert.doesNotMatch(container.textContent ?? "", /Sender b/);
		assert.match(container.textContent ?? "", /Sender c/);
	});

	it("shows the rows a consumer added after mount", () => {
		render(sectionsOf("a"));
		render(sectionsOf("a", "b"));
		assert.match(container.textContent ?? "", /Sender b/);
	});
});

describe("TouchListBody swipe-to-toggle-read", () => {
	it("leaves the row at the state the swipe landed on", () => {
		render(sectionsOf("a", "b"), "leading");
		assert.equal(unreadRows(), 2, "both rows start unread");
		click("Mark as read");
		assert.equal(unreadRows(), 1, "the swiped row is read");
	});

	it("does not invert a row the consumer has since marked read", () => {
		render(sectionsOf("a", "b"), "leading");
		click("Mark as read");
		render(readOf("a", "b"));
		assert.equal(unreadRows(), 0, "a row the consumer marked read stays read");
	});
});
