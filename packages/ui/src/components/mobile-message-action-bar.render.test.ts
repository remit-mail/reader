import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MobileMessageActionBar } from "./mobile-message-action-bar.js";

// A wired host, as both real callers are: the bar offers only the verbs it was
// given an answer for.
const base = {
	hasThread: true,
	onReply: () => undefined,
	onReplyAll: () => undefined,
	onForward: () => undefined,
	onToggleStar: () => undefined,
	onDelete: () => undefined,
} as const;

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
		assert.equal(countMatches(html, 'aria-label="Star"'), 1);
		assert.equal(countMatches(html, 'aria-label="Move to folder"'), 1);
		assert.equal(countMatches(html, 'aria-label="Move to Trash"'), 1);
		assert.doesNotMatch(html, /aria-label="Archive"/);
	});

	it("flips the star label when starred", () => {
		const html = renderToString(
			createElement(MobileMessageActionBar, { ...base, isStarred: true }),
		);
		assert.match(html, /aria-label="Unstar"/);
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
		assert.equal(countMatches(html, 'aria-label="Reply"'), 1);
		assert.equal(countMatches(html, 'aria-label="Reply all"'), 1);
		assert.equal(countMatches(html, 'aria-label="Forward"'), 1);
		assert.doesNotMatch(html, /intelligence panel/);
	});

	it("drops a verb the host supplies no handler for", () => {
		const html = renderToString(
			createElement(MobileMessageActionBar, {
				hasThread: true,
				onReply: () => undefined,
			}),
		);
		assert.equal(countMatches(html, 'aria-label="Reply"'), 1);
		assert.doesNotMatch(html, /aria-label="Reply all"/);
		assert.doesNotMatch(html, /aria-label="Forward"/);
	});

	it("never disables a verb it offers", () => {
		const html = renderToString(createElement(MobileMessageActionBar, base));
		assert.equal(countMatches(html, 'aria-label="Reply"'), 1);
		assert.doesNotMatch(html, /disabled=""/);
	});

	it("keeps the host's verbs pressable with no message open", () => {
		const html = renderToString(
			createElement(MobileMessageActionBar, {
				hasThread: false,
				onReply: () => undefined,
				onReplyAll: () => undefined,
				onForward: () => undefined,
			}),
		);
		assert.equal(countMatches(html, 'aria-label="Reply"'), 1);
		assert.equal(countMatches(html, 'aria-label="Reply all"'), 1);
		assert.equal(countMatches(html, 'aria-label="Forward"'), 1);
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
