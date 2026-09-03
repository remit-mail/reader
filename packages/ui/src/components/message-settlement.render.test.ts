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

describe("an unsettled row says so", () => {
	it("marks a row whose mutation gave up", () => {
		const html = row("abandoned");
		assert.match(html, /data-settlement="abandoned"/);
		assert.match(html, new RegExp(messageSettlementCopy.abandoned.label));
	});

	it("marks a row whose mutation is still in flight", () => {
		const html = row("in_flight");
		assert.match(html, /data-settlement="in_flight"/);
		assert.match(html, new RegExp(messageSettlementCopy.in_flight.label));
	});

	it("carries the same mark in compact density", () => {
		assert.match(compactRow("abandoned"), /data-settlement="abandoned"/);
	});

	it("leaves a settled row exactly as it was", () => {
		assert.doesNotMatch(row(), /data-settlement/);
		assert.doesNotMatch(compactRow(), /data-settlement/);
	});
});

describe("the reading-pane notice", () => {
	it("raises an alert and offers the way out when the mutation gave up", () => {
		const html = renderToString(
			createElement(MessageSettlementNotice, {
				settlement: "abandoned",
				reportHref: "https://example.test/new-issue",
			}),
		);
		assert.match(html, /role="alert"/);
		assert.match(html, new RegExp(messageSettlementCopy.abandoned.title));
		assert.match(html, /Report an issue/);
		assert.match(html, /https:\/\/example\.test\/new-issue/);
	});

	it("states an in-flight push without raising an alert or an action", () => {
		const html = renderToString(
			createElement(MessageSettlementNotice, { settlement: "in_flight" }),
		);
		assert.match(html, /role="status"/);
		assert.doesNotMatch(html, /Report an issue/);
	});
});
