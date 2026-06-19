import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { OutboxRow } from "./outbox-row.js";

const baseProps = {
	recipients: "alex@example.com",
	subject: "Hello",
	time: "9:42",
	onSelect: () => undefined,
	onEdit: () => undefined,
	onDelete: () => undefined,
};

describe("OutboxRow", () => {
	it("renders recipients, subject and the status label", () => {
		const html = renderToString(
			createElement(OutboxRow, { ...baseProps, status: "queued" }),
		);
		assert.match(html, /alex@example\.com/);
		assert.match(html, /Hello/);
		assert.match(html, /Queued/);
	});

	it("hides the action cluster for in-flight statuses", () => {
		const html = renderToString(
			createElement(OutboxRow, { ...baseProps, status: "sending" }),
		);
		assert.doesNotMatch(html, /aria-label="Delete message"/);
	});

	it("shows retry, edit and delete for a failed row, never disabled", () => {
		const html = renderToString(
			createElement(OutboxRow, {
				...baseProps,
				status: "failed",
				error: "SMTP refused",
				onRetry: () => undefined,
			}),
		);
		assert.match(html, /aria-label="Retry sending"/);
		assert.match(html, /aria-label="Edit as draft"/);
		assert.match(html, /aria-label="Delete message"/);
		assert.match(html, /SMTP refused/);
		assert.doesNotMatch(html, /disabled=""/);
	});

	it("omits retry for a blocked row but keeps edit and delete", () => {
		const html = renderToString(
			createElement(OutboxRow, {
				...baseProps,
				status: "blocked",
				error: "no SMTP host",
			}),
		);
		assert.doesNotMatch(html, /aria-label="Retry sending"/);
		assert.match(html, /aria-label="Edit as draft"/);
		assert.match(html, /aria-label="Delete message"/);
	});
});
