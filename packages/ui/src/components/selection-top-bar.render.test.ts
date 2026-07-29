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

const hasRow = (html: string, name: "actions" | "select-all"): boolean =>
	html.includes(`data-selection-bar-row="${name}"`);

const INLINE_SELECT_ALL = /hidden shrink-0 pr-2 md:flex/;

const selectAll = { checked: false, onChange: () => undefined };

describe("SelectionTopBar", () => {
	it("names the mailbox when nothing is ticked", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 0 }),
		);
		assert.match(text(html), /Inbox/);
		assert.doesNotMatch(text(html), /messages selected/);
	});

	it("carries the list header's own chrome while nothing is ticked", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 0,
				navSlot: createElement("button", { type: "button" }, "Menu"),
				titleMeta: createElement("span", null, "12 unread"),
				searchSlot: createElement("button", { type: "button" }, "Search"),
			}),
		);
		assert.match(text(html), /Menu/);
		assert.match(text(html), /12 unread/);
		assert.match(text(html), /Search/);
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

	it("lets the expanded search field take the title's place while idle", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 0,
				searchField: createElement("input", { "aria-label": "Search mail" }),
			}),
		);
		assert.match(html, /aria-label="Search mail"/);
		assert.doesNotMatch(text(html), /Inbox/);
	});

	it("offers Something else as an overflow verb, never a glyph", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				onSomethingElse: () => undefined,
			}),
		);
		assert.match(html, /aria-label="More actions"/);
		assert.doesNotMatch(row(html, "actions"), /aria-label="Something else"/);
	});

	it("replaces the title with the count from the first ticked row", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 1 }),
		);
		assert.match(text(html), /1 message selected/);
		assert.doesNotMatch(text(html), /Inbox/);
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
				moveSlot: createElement(
					"button",
					{ type: "button", "aria-label": "Move selected messages" },
					"Move",
				),
			}),
		);

		it("carries the count and the three verbs on row one", () => {
			const actions = row(html, "actions");
			assert.match(actions, /3 messages selected/);
			assert.match(actions, /aria-label="Move selected messages to Trash"/);
			assert.match(actions, /aria-label="Move selected messages"/);
			assert.match(actions, /aria-label="Organize selected messages"/);
		});

		it("puts select-all on a second row, out of the way of the verbs", () => {
			assert.ok(hasRow(html, "select-all"));
			const secondRow = row(html, "select-all");
			assert.match(secondRow, /Select all/);
			assert.match(
				secondRow,
				/md:hidden/,
				"the second row exists only below 768px",
			);
			assert.match(
				row(html, "actions"),
				INLINE_SELECT_ALL,
				"the inline copy is the one that stands down below 768px",
			);
		});

		it("offers a back arrow to leave selection", () => {
			assert.match(row(html, "actions"), /aria-label="Cancel selection"/);
		});
	});

	describe("at 1024px", () => {
		it("keeps select-all inline in the bar with zero rows ticked", () => {
			const html = renderToString(
				createElement(SelectionTopBar, { ...handlers, count: 0, selectAll }),
			);
			const actions = row(html, "actions");
			assert.match(actions, /Select all/);
			assert.match(actions, INLINE_SELECT_ALL, "inline from 768px up");
			assert.doesNotMatch(
				actions,
				/aria-label="Cancel selection"/,
				"nothing to leave with nothing ticked",
			);
			assert.equal(
				hasRow(html, "select-all"),
				false,
				"no second row when nothing is ticked",
			);
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

	it("renders the verbs at the 44px touch size", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				onOrganize: () => undefined,
			}),
		);
		const buttonCount = (html.match(/h-11 w-11/g) ?? []).length;
		assert.equal(buttonCount, 3, "back, delete and organize are all 44px");
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

	it("renders statusLabel in place of the count copy when provided", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 3412,
				statusLabel: "Deleting 1,200 of 3,412…",
			}),
		);
		assert.match(text(html), /Deleting 1,200 of 3,412…/);
		assert.doesNotMatch(text(html), /3,412 messages selected/);
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

	it("omits the select-all control when selectAll is absent", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.doesNotMatch(text(html), /Select all/);
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

	it("lets statusLabel override the scoped default for an escalated selection", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 3412,
				selectAll: { checked: true, onChange: () => undefined },
				statusLabel: 'All 3,412 matching "npm" selected',
			}),
		);
		assert.match(text(html), /All 3,412 matching "npm" selected/);
	});

	it("renders the notice text and tone", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 2,
				notice: {
					tone: "warning",
					text: "Move only works within one account",
				},
			}),
		);
		assert.match(text(html), /Move only works within one account/);
		assert.match(html, /role="status"/);
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

	it("omits the notice when absent", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		// Only the count/status line carries role="status" — no second one for
		// an absent notice.
		const statusRoles = (html.match(/role="status"/g) ?? []).length;
		assert.equal(statusRoles, 1);
	});

	it("renders a determinate progress bar when progress is provided", () => {
		const html = renderToString(
			createElement(SelectionTopBar, {
				...handlers,
				count: 3412,
				statusLabel: "Deleting 1,200 of 3,412…",
				isBusy: true,
				progress: { value: 1200, max: 3412 },
			}),
		);
		assert.match(html, /role="progressbar"/);
		assert.match(html, /aria-valuenow="1200"/);
	});

	it("omits the progress bar when progress is absent", () => {
		const html = renderToString(
			createElement(SelectionTopBar, { ...handlers, count: 2 }),
		);
		assert.doesNotMatch(html, /role="progressbar"/);
	});
});
