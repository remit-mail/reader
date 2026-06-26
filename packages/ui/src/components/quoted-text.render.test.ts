import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QuotedText } from "./quoted-text.js";

describe("QuotedText", () => {
	it("renders nothing when there is no text or html", () => {
		assert.equal(renderToString(createElement(QuotedText, { text: "" })), "");
	});

	it("shows the attribution and a collapse toggle by default", () => {
		const html = renderToString(
			createElement(QuotedText, {
				text: "hello",
				senderName: "Dana Whitfield",
				date: "Jun 24, 2026",
			}),
		);
		assert.match(html, /Dana Whitfield on Jun 24, 2026 wrote:/);
		assert.match(html, /aria-expanded="false"/);
	});

	it("falls back to a generic label when there is no attribution", () => {
		const html = renderToString(createElement(QuotedText, { text: "hello" }));
		assert.match(html, /Show quoted text/);
	});

	it("keeps the quoted body collapsed initially", () => {
		const html = renderToString(
			createElement(QuotedText, {
				text: "secret quoted line",
				html: "<p>secret quoted html</p>",
				senderName: "Dana",
			}),
		);
		assert.doesNotMatch(html, /secret quoted/);
	});
});
