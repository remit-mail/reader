import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	MessageListEmpty,
	MessageListError,
	MessageListLoading,
} from "./message-list-state.js";

describe("MessageListLoading", () => {
	const html = renderToString(createElement(MessageListLoading));

	it("renders eight skeleton rows", () => {
		const rows = html.match(/animate-pulse/g) ?? [];
		assert.equal(rows.length, 8, "eight pulse rows, like the live skeleton");
	});

	it("marks the region busy for assistive tech", () => {
		assert.match(html, /aria-busy="true"/);
	});
});

describe("MessageListEmpty", () => {
	it("uses the plain mailbox copy with no query", () => {
		const html = renderToString(createElement(MessageListEmpty, {}));
		assert.match(html, /No messages in this mailbox/);
	});

	it("switches to the search copy when a query is active", () => {
		const html = renderToString(
			createElement(MessageListEmpty, { searchQuery: "invoice" }),
		);
		assert.match(html, /No messages match your search/);
	});

	it("treats a whitespace-only query as no search", () => {
		const html = renderToString(
			createElement(MessageListEmpty, { searchQuery: "   " }),
		);
		assert.match(html, /No messages in this mailbox/);
	});
});

describe("MessageListError", () => {
	it("fails hard: alert role, plain failure line, and the detail message", () => {
		const html = renderToString(
			createElement(MessageListError, { message: "Network unreachable" }),
		);
		assert.match(html, /role="alert"/, "blocking alert, never a toast");
		assert.match(html, /Couldn&#x27;t load messages/, "plain failure line");
		assert.match(html, /Network unreachable/);
	});

	it("offers a way back and a report path when handlers are given", () => {
		const html = renderToString(
			createElement(MessageListError, {
				onRetry: () => {},
				onReport: () => {},
			}),
		);
		assert.match(html, /Retry/);
		assert.match(html, /Report a problem/);
	});

	it("never renders a disabled control", () => {
		const html = renderToString(
			createElement(MessageListError, { onRetry: () => {} }),
		);
		assert.doesNotMatch(html, /\sdisabled[\s=>]/);
	});
});
