import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SelectionTopBar } from "./selection-top-bar.js";

const handlers = {
	title: "Inbox",
	onCancel: () => undefined,
	onDelete: () => undefined,
};

/** SSR interleaves `<!-- -->` markers between interpolated text nodes and
 *  HTML-encodes entities; strip tags/comments and decode the handful of
 *  entities copy assertions actually hit, so they match the rendered words. */
const text = (html: string) =>
	html
		.replace(/<[^>]*>/g, "")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&amp;/g, "&");

/** The bar's own rows, sliced out of the rendered markup so an assertion can
 *  say which row a control landed on. Row one is the count and the verbs; the
 *  select-all row exists only below 768px, while selecting. */
const row = (html: string, name: "actions" | "select-all"): string => {
	const open = html.indexOf(`data-selection-bar-row="${name}"`);
	assert.notEqual(open, -1, `no ${name} row rendered`);
	const rest = html.slice(open);
	const next = rest.indexOf("data-selection-bar-row=", 1);
	return next === -1 ? rest : rest.slice(0, next);
};

const selectAll = { checked: false, onChange: () => undefined };

describe("SelectionTopBar", () => {
	it("names the mailbox when nothing is ticked", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 0 }),
		);
		assert.match(text(html), /Inbox/);
		assert.doesNotMatch(text(html), /messages selected/);
	});

	it("hands the row to the count and the verbs from the first ticked row", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 1,
				navSlot: createElement("button", { type: "button" }, "Menu"),
				titleMeta: createElement("span", null, "12 unread"),
				searchSlot: createElement("button", { type: "button" }, "Search"),
			}),
		);
		assert.match(text(html), /1 message selected/);
		assert.doesNotMatch(text(html), /12 unread/);
		assert.doesNotMatch(text(html), /Search/);
	});

	it("carries the make-filter row while nothing is ticked, and drops it once something is", () => {
		const idleSlot = createElement("button", { type: "button" }, "Make filter");
		assert.match(
			text(
				renderToString(
					createElement(SelectionTopBar, { ...handlers, count: 0, idleSlot }),
				),
			),
			/Make filter/,
		);
		assert.doesNotMatch(
			text(
				renderToString(
					createElement(SelectionTopBar, { ...handlers, count: 2, idleSlot }),
				),
			),
			/Make filter/,
		);
	});

	it("renders plural copy for many messages", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 3 }),
		);
		assert.match(text(html), /3 messages selected/);
	});

	it("applies thousands separators to the default count copy", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 3412 }),
		);
		assert.match(text(html), /3,412 messages selected/);
	});

	describe("at 375px", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 3,
				selectAll,
				onOrganize: () => undefined,
				onMove: () => undefined,
			}),
		);

		it("carries the count and the three verbs on row one", () => {
			const actions = row(html, "actions");
			assert.match(actions, /3 messages selected/);
			assert.match(actions, /aria-label="Move selected messages to Trash"/);
			assert.match(actions, /aria-label="Move selected messages"/);
			assert.match(actions, /aria-label="Organize selected messages"/);
		});

		it("offers a back arrow to leave selection", () => {
			assert.match(row(html, "actions"), /aria-label="Cancel selection"/);
		});
	});

	it("renders Junk and Mark read in the overflow menu, not the verb row", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				onJunk: () => undefined,
				onMarkRead: () => undefined,
			}),
		);
		assert.match(html, /aria-label="More actions"/);
		assert.match(html, /aria-haspopup="menu"/);
		assert.doesNotMatch(row(html, "actions"), /aria-label="Mark as read"/);
	});

	it("keeps the overflow menu for an overflowSlot with no verbs of its own", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				overflowSlot: createElement("span", null, "Apply label"),
			}),
		);
		assert.match(html, /aria-label="More actions"/);
	});

	it("withdraws the overflowSlot while busy", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				isBusy: true,
				overflowSlot: createElement("span", null, "Apply label"),
			}),
		);
		assert.doesNotMatch(html, /aria-label="More actions"/);
	});

	it("renders no overflow trigger when neither overflow verb is wired", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.doesNotMatch(html, /aria-label="More actions"/);
	});

	it("drops the overflow verbs while busy instead of disabling them", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				onMarkRead: () => undefined,
				onJunk: () => undefined,
				isBusy: true,
			}),
		);
		assert.doesNotMatch(html, /aria-label="More actions"/);
	});

	it("hides the verbs while counting", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 0,
				isCounting: true,
				onOrganize: () => undefined,
			}),
		);
		assert.doesNotMatch(html, /aria-label="Move selected messages to Trash"/);
		assert.doesNotMatch(html, /aria-label="Organize selected messages"/);
	});

	it("marks the count/status line as a polite live region", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.match(
			html,
			/role="status"[^>]*aria-live="polite"[^>]*>2 messages selected/,
		);
	});

	it("renders select-all unchecked in the some-selected state", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				selectAll: {
					checked: false,
					indeterminate: true,
					onChange: () => undefined,
				},
			}),
		);
		assert.match(text(html), /Select all/);
		assert.doesNotMatch(html, /type="checkbox"[^>]*checked=""/);
	});

	it("names the control by what pressing it does once everything is ticked", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 12,
				selectAll: {
					checked: true,
					indeterminate: false,
					onChange: () => undefined,
				},
			}),
		);
		assert.match(html, /type="checkbox"[^>]*checked=""/);
		assert.match(text(html), /Deselect all/);
	});

	it("names the loaded scope by default once select-all is checked", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 47,
				selectAll: {
					checked: true,
					indeterminate: false,
					onChange: () => undefined,
				},
			}),
		);
		assert.match(text(html), /All 47 loaded selected/);
	});

	it("renders the notice's action as a real button, not prose", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 340,
				notice: {
					tone: "danger",
					text: "3,072 moved to Trash. 340 couldn't be deleted.",
					action: { label: "Retry 340", onClick: () => undefined },
				},
			}),
		);
		assert.match(html, /<button[^>]*>Retry 340<\/button>/);
	});
});
