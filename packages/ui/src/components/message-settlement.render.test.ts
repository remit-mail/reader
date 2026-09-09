import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadRowData } from "./app-shell-types.js";
import { ComfortableRow, CompactRow } from "./message-row.js";
import {
	MessageSettlementNotice,
	messageSettlementCopy,
	type RowSettlement,
} from "./message-settlement.js";

const thread: ThreadRowData = {
	id: "m1",
	fromName: "Tomas Berg",
	fromEmail: "tomas@example.com",
	subject: "Signed lease, final version",
	snippet: "The countersigned copy is attached.",
	timeLabel: "Mon",
	isRead: true,
};

const row = (settlement?: RowSettlement) =>
	renderToString(
		createElement(ComfortableRow, {
			thread: settlement ? { ...thread, settlement } : thread,
		}),
	);

const compactRow = (settlement?: RowSettlement) =>
	renderToString(
		createElement(CompactRow, {
			thread: settlement ? { ...thread, settlement } : thread,
		}),
	);

describe("a row whose mutation gave up says so, and says which", () => {
	it("marks the row", () => {
		const html = row("delete_failed");
		assert.match(html, /data-settlement="delete_failed"/);
		assert.match(html, new RegExp(messageSettlementCopy.delete_failed.label));
	});

	// Issue #1229: a move that handed back used to render the delete chip, so
	// the row named an operation the user never asked to fail.
	it("marks a move that gave up as a move, never as a delete", () => {
		const html = row("move_failed");
		assert.match(html, /data-settlement="move_failed"/);
		assert.match(html, new RegExp(messageSettlementCopy.move_failed.label));
		assert.doesNotMatch(html, /Not deleted/);
	});

	it("carries the same mark in compact density", () => {
		assert.match(
			compactRow("delete_failed"),
			/data-settlement="delete_failed"/,
		);
		assert.match(compactRow("move_failed"), /data-settlement="move_failed"/);
	});

	it("leaves every other row exactly as it was", () => {
		assert.doesNotMatch(row(), /data-settlement/);
		assert.doesNotMatch(compactRow(), /data-settlement/);
	});
});

describe("the reading-pane notice", () => {
	it("states the failure and offers both ways out", () => {
		const html = renderToString(
			createElement(MessageSettlementNotice, {
				settlement: "delete_failed",
				onRetry: () => undefined,
				reportHref: "https://example.test/new-issue",
			}),
		);
		assert.match(html, /role="alert"/);
		assert.match(html, new RegExp(messageSettlementCopy.delete_failed.title));
		assert.match(
			html,
			new RegExp(messageSettlementCopy.delete_failed.retryLabel),
		);
		assert.match(html, /Report an issue/);
		assert.match(html, /https:\/\/example\.test\/new-issue/);
	});

	// The retry has to repeat the operation that failed. A move cannot: the
	// destination the give-up discarded is on no row, so its way out is the
	// caller's folder picker, passed in as the action.
	it("states a move that failed and takes the caller's retry in place of a button", () => {
		const html = renderToString(
			createElement(MessageSettlementNotice, {
				settlement: "move_failed",
				action: createElement("button", { type: "button" }, "Move again"),
				reportHref: "https://example.test/new-issue",
			}),
		);
		assert.match(html, new RegExp(messageSettlementCopy.move_failed.title));
		assert.match(html, /Move again/);
		assert.doesNotMatch(html, /Delete again/);
	});

	it("disables the retry while one is in flight rather than dropping it", () => {
		const html = renderToString(
			createElement(MessageSettlementNotice, {
				settlement: "delete_failed",
				onRetry: () => undefined,
				retryPending: true,
			}),
		);
		assert.match(html, /disabled/);
		assert.match(html, /Deleting/);
	});
});
