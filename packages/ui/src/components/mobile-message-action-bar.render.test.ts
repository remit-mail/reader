import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MobileMessageActionBar } from "./mobile-message-action-bar.js";

const base = { hasThread: true } as const;

const countMatches = (html: string, needle: string) =>
	html.split(needle).length - 1;

describe("MobileMessageActionBar", () => {
	it("renders exactly one star and one trash, and no archive (IMAP has no archive)", () => {
		const html = renderToString(
			createElement(MobileMessageActionBar, {
				...base,
				moveSlot: createElement("button", {
					type: "button",
					"aria-label": "Move to folder",
				}),
			}),
		);
		assert.equal(countMatches(html, 'aria-label="Flag"'), 1);
		assert.equal(countMatches(html, 'aria-label="Move to folder"'), 1);
		assert.equal(countMatches(html, 'aria-label="Move to Trash"'), 1);
		assert.doesNotMatch(html, /aria-label="Archive"/);
	});

	it("flips the star label when starred", () => {
		const html = renderToString(
			createElement(MobileMessageActionBar, { ...base, isStarred: true }),
		);
		assert.match(html, /aria-label="Remove flag"/);
		assert.match(html, /aria-pressed="true"/);
	});

	it("renders the move slot the caller supplies", () => {
		const html = renderToString(
			createElement(MobileMessageActionBar, {
				...base,
				moveSlot: createElement("button", {
					type: "button",
					"aria-label": "Move to folder",
				}),
			}),
		);
		assert.match(html, /aria-label="Move to folder"/);
	});

	it("shows the overflow trigger when a mark-read handler is present", () => {
		const html = renderToString(
			createElement(MobileMessageActionBar, {
				...base,
				onToggleRead: () => undefined,
			}),
		);
		assert.match(html, /aria-label="More actions"/);
	});

	it("omits the overflow trigger with no overflow actions", () => {
		const html = renderToString(createElement(MobileMessageActionBar, base));
		assert.doesNotMatch(html, /aria-label="More actions"/);
	});

	it("renders the per-message reply verbs and no intelligence toggle", () => {
		const html = renderToString(createElement(MobileMessageActionBar, base));
		assert.match(html, /aria-label="Reply"/);
		assert.match(html, /aria-label="Reply all"/);
		assert.match(html, /aria-label="Forward"/);
		assert.doesNotMatch(html, /intelligence panel/);
	});

	it("keeps verbs pressable rather than disabling them", () => {
		const html = renderToString(createElement(MobileMessageActionBar, base));
		assert.doesNotMatch(html, /disabled=""/);
	});

	it("surfaces the unavailable hint when no message is open", () => {
		const html = renderToString(
			createElement(MobileMessageActionBar, {
				hasThread: false,
				unavailableHint: "Open a message first",
			}),
		);
		assert.match(html, /Open a message first/);
	});
});
