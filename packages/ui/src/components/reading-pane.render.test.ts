import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ThreadMessageData } from "./app-shell-types.js";
import { CollapsedMessage } from "./reading-pane.js";

const message: ThreadMessageData = {
	id: "m-1",
	fromName: "Jamie Chen",
	fromEmail: "jamie@example.com",
	toLabel: "Alex Rivera, you",
	dateLabel: "Today, 09:11",
	snippet: "Circulating the deck this afternoon.",
	bodyHtml: "<p>body</p>",
};

describe("CollapsedMessage nested-button fix (#1232)", () => {
	it("renders the clickable row as a role=button div so a trailing button doesn't nest inside a button", () => {
		const html = renderToString(
			createElement(CollapsedMessage, {
				message,
				onClick: () => {},
				trailing: createElement(
					"button",
					{ type: "button", "aria-label": "Add star" },
					"star",
				),
			}),
		);
		// The row itself is a div, keyboard-operable via role/tabindex — not a
		// native <button>. The only <button> in the output is the trailing star.
		assert.match(html, /^<div/);
		assert.match(html, /role="button"/);
		assert.match(html, /tabindex="0"/);
		assert.match(html, /aria-expanded="false"/);
		assert.equal(html.match(/<button/g)?.length ?? 0, 1);
	});

	it("renders a static row (no onClick) with no button role and no tabindex", () => {
		const html = renderToString(createElement(CollapsedMessage, { message }));
		assert.doesNotMatch(html, /role="button"/);
		assert.doesNotMatch(html, /tabindex=/);
	});
});
