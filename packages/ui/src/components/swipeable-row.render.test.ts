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
});
