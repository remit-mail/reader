import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadRowData } from "./app-shell-types.js";
import { SwipeableRow, type SwipePeek } from "./swipeable-row.js";

const thread: ThreadRowData = {
	id: "thread-1",
	accountId: "account-1",
	fromName: "Alex Rivera",
	fromEmail: "alex@example.com",
	subject: "Q3 planning notes",
	snippet: "Notes from the planning session.",
	timeLabel: "9:42",
	isRead: false,
};

const baseProps = {
	thread,
	selectionMode: false,
	checked: false,
	active: false,
	onPeek: () => undefined,
	onToggleCheck: () => undefined,
	onLongPress: () => undefined,
	onOpen: () => undefined,
	onAct: () => undefined,
};

function render(peek: SwipePeek, override?: Partial<typeof baseProps>) {
	return renderToString(
		createElement(SwipeableRow, { ...baseProps, ...override, peek }),
	);
}

describe("SwipeableRow", () => {
	it("renders no action background at rest", () => {
		const html = render("none");
		assert.doesNotMatch(html, /bg-danger/);
		assert.doesNotMatch(html, /bg-accent-2(?!-soft)/);
		assert.doesNotMatch(html, /aria-label="Delete message"/);
	});

	it("reveals the delete action when peeked trailing", () => {
		const html = render("trailing");
		assert.match(html, /aria-label="Delete message"/);
		assert.match(html, /bg-danger/);
		assert.match(html, /translateX\(-72px\)/);
	});

	it("reveals the toggle-read action when peeked leading", () => {
		const unread = render("leading");
		assert.match(unread, /aria-label="Mark as read"/);
		assert.match(unread, /bg-accent-2/);
		assert.match(unread, /translateX\(72px\)/);

		const read = render("leading", { thread: { ...thread, isRead: true } });
		assert.match(read, /aria-label="Mark as unread"/);
	});

	it("opens through a button, never an anchor (#116)", () => {
		for (const html of [
			render("none"),
			render("none", { selectionMode: true }),
		]) {
			assert.match(html, /<button[^>]*data-message-row/);
			assert.doesNotMatch(html, /<a /);
		}
	});

	it("gives the row checkbox semantics while in selection mode", () => {
		const checked = render("none", { selectionMode: true, checked: true });
		assert.match(checked, /role="checkbox"/);
		assert.match(checked, /aria-checked="true"/);

		const unchecked = render("none", { selectionMode: true, checked: false });
		assert.match(unchecked, /aria-checked="false"/);
	});

	it("does not put checkbox semantics on the outer row outside selection mode", () => {
		// Outside selection mode the row's own open control (the outer button)
		// stays a plain button — only the nested leading-avatar toggle carries
		// checkbox semantics, asserted separately below.
		const html = render("none");
		const outerTag = html.match(
			/^<div class="relative overflow-hidden"><button type="button"[^>]*>/,
		)?.[0];
		assert.ok(outerTag, "outer row button found");
		assert.doesNotMatch(outerTag as string, /role="checkbox"/);
	});

	it("renders the leading avatar as a focusable checkbox-role toggle outside selection mode", () => {
		const html = render("none");
		assert.match(
			html,
			/role="checkbox"[^>]*aria-label="Select message from Alex Rivera"/,
		);
	});
});
