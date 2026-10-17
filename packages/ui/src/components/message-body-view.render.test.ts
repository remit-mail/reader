import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MessageBodyView } from "./message-body-view.js";

/**
 * `MessageBodyView` sanitizes via DOMPurify, which needs a DOM. Under SSR /
 * plain-node (no DOM) the component cannot sanitize, so it never emits the email
 * HTML — that guard is the security contract: unsanitizable mail is not
 * rendered. These tests cover the DOM-free paths (empty + plain-text fallback +
 * the no-DOM HTML guard); the sanitize/classify behavior is pinned by the
 * sanitizer + render-treatment unit tests, and the live rendering by the
 * Storybook stories.
 */
describe("MessageBodyView", () => {
	it("does not emit raw email HTML without a DOM to sanitize it", () => {
		// No DOM ⇒ cannot DOMPurify ⇒ the component must NOT paint the HTML.
		const html = renderToString(
			createElement(MessageBodyView, {
				html: "<p>secret newsletter body</p>",
				category: "newsletter",
			}),
		);
		assert.doesNotMatch(html, /secret newsletter body/);
	});

	it("falls back to text when html cannot be sanitized (no DOM)", () => {
		const html = renderToString(
			createElement(MessageBodyView, {
				html: "<p>html body</p>",
				text: "plain fallback",
			}),
		);
		assert.doesNotMatch(html, /html body/);
		assert.match(html, /plain fallback/);
	});
});
