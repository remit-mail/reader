/**
 * Row semantics for the shared `MessageRow` (#149).
 *
 * `role="option"` belongs to the mailbox list, whose rows sit inside a
 * `role="listbox"` container. The brief and Flagged render rows in ordinary
 * containers: an orphan `option` there is invalid ARIA and, more concretely,
 * strips the row of its button role — which is how the black-box suite and any
 * screen reader address it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ThreadRowData } from "@remit/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MessageRow } from "./MessageRow";

(globalThis as { React?: typeof React }).React = React;

const thread: ThreadRowData = {
	id: "m1",
	accountId: "a1",
	fromName: "Alex Rivera",
	fromEmail: "alex@example.com",
	subject: "Quarterly numbers are in",
	snippet: "The deck is on the shared drive.",
	timeLabel: "9:42",
	isRead: true,
};

const render = (props: Parameters<typeof MessageRow>[0]): string =>
	renderToString(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			createElement(MessageRow, props),
		) as never,
	);

describe("MessageRow semantics", () => {
	it("renders a plain button outside a listbox (brief, Flagged)", () => {
		const html = render({ thread });
		assert.match(html, /<button/);
		assert.doesNotMatch(html, /role="option"/);
		assert.doesNotMatch(html, /aria-selected/);
	});

	it("renders listbox option semantics when the container is a listbox", () => {
		const html = render({ thread, inListbox: true });
		assert.match(html, /role="option"/);
		assert.match(html, /aria-selected/);
	});

	it("renders the row's sender, subject and snippet", () => {
		const html = render({ thread });
		assert.match(html, /Alex Rivera/);
		assert.match(html, /Quarterly numbers are in/);
		assert.match(html, /shared drive/);
	});
});
