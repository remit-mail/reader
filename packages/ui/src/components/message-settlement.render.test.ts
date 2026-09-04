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

describe("a row whose delete gave up says so", () => {
	it("marks the row", () => {
		const html = row("delete_failed");
		assert.match(html, /data-settlement="delete_failed"/);
		assert.match(html, new RegExp(messageSettlementCopy.delete_failed.label));
	});

	it("carries the same mark in compact density", () => {
		assert.match(
			compactRow("delete_failed"),
			/data-settlement="delete_failed"/,
		);
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
