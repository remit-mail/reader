import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	type MoveMailboxOption,
	MoveMailboxPicker,
	moveMailboxPickerInternals,
} from "./move-mailbox-picker.js";

const {
	findFirstSelectable,
	findLastSelectable,
	findNextSelectable,
	matchesQuery,
} = moveMailboxPickerInternals;

const options: MoveMailboxOption[] = [
	{ id: "inbox", label: "Inbox", isCurrent: true },
	{ id: "archive", label: "Archive" },
	{ id: "trash", label: "Trash" },
];

describe("roving-focus selection", () => {
	it("skips the current folder when finding the first selectable", () => {
		assert.equal(findFirstSelectable(options), 1);
	});

	it("finds the last selectable", () => {
		assert.equal(findLastSelectable(options), 2);
	});

	it("wraps forward over the non-selectable current folder", () => {
		assert.equal(findNextSelectable(options, 2, 1), 1);
	});

	it("wraps backward over the non-selectable current folder", () => {
		assert.equal(findNextSelectable(options, 1, -1), 2);
	});

	it("returns -1 when every option is the current folder", () => {
		const allCurrent: MoveMailboxOption[] = [
			{ id: "a", label: "A", isCurrent: true },
		];
		assert.equal(findFirstSelectable(allCurrent), -1);
		assert.equal(findNextSelectable(allCurrent, 0, 1), -1);
	});
});

describe("query matching", () => {
	it("matches on the display label, case-insensitively", () => {
		assert.equal(matchesQuery({ id: "a", label: "Archive" }, "arch"), true);
	});

	it("matches on the hidden searchValue (nested path)", () => {
		assert.equal(
			matchesQuery(
				{ id: "r", label: "Receipts", searchValue: "finance/receipts" },
				"finance/",
			),
			true,
		);
	});

	it("does not match unrelated text", () => {
		assert.equal(matchesQuery({ id: "a", label: "Archive" }, "spam"), false);
	});
});

describe("MoveMailboxPicker render", () => {
	it("renders each mailbox as a listbox option", () => {
		const html = renderToString(
			createElement(MoveMailboxPicker, {
				mailboxes: options,
				onSelect: () => {},
			}),
		);
		assert.match(html, /role="listbox"/);
		const optionCount = html.match(/role="option"/g)?.length ?? 0;
		assert.equal(optionCount, 3);
	});

	it("marks the current folder as a non-interactive marker, never a disabled button", () => {
		const html = renderToString(
			createElement(MoveMailboxPicker, {
				mailboxes: options,
				onSelect: () => {},
			}),
		);
		assert.match(html, /aria-label="Inbox \(current folder\)"/);
		assert.match(html, /aria-current="true"/);
		assert.match(html, /aria-label="Move to Archive"/);
		assert.doesNotMatch(html, /disabled/);
	});

	it("renders the empty state when there are no mailboxes", () => {
		const html = renderToString(
			createElement(MoveMailboxPicker, { mailboxes: [], onSelect: () => {} }),
		);
		assert.match(html, /No folders match/);
	});

	it("applies caller-supplied labels", () => {
		const html = renderToString(
			createElement(MoveMailboxPicker, {
				mailboxes: options,
				onSelect: () => {},
				labels: { optionLabel: (label) => `Verplaats naar ${label}` },
			}),
		);
		assert.match(html, /aria-label="Verplaats naar Archive"/);
	});
});
