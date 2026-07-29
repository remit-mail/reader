import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { BlockedReason } from "./blocked-reason.js";

const REASON = "Pick a destination first.";

/**
 * Nothing disables (#477 1.7), so a dimmed control has to say what it is missing
 * two ways: a description that is there for as long as the block is, and an
 * announcement that happens when the control is pressed.
 *
 * They are separate elements because a live region announces what is written
 * into it. One element that already holds the reason and gains `role="status"`
 * on the press has nothing written into it, so nothing is announced — which is
 * how a wizard comes to have a visual-only answer to "why can't I continue".
 */
describe("BlockedReason", () => {
	it("describes the control before anything is pressed, silently", () => {
		const html = renderToString(
			createElement(BlockedReason, { id: "reason", reason: REASON }),
		);
		assert.match(html, /<p id="reason"[^>]*sr-only/);
		assert.match(html, new RegExp(REASON));
		// The live region is mounted and empty: there is nothing to announce yet.
		assert.match(html, /role="status"[^>]*><\/span>/);
	});

	it("shows and announces the same reason once it has been pressed", () => {
		const html = renderToString(
			createElement(BlockedReason, {
				id: "reason",
				reason: REASON,
				nudged: true,
				className: "text-warning",
			}),
		);
		assert.doesNotMatch(html, /role="status"[^>]*><\/span>/);
		assert.match(html, new RegExp(`role="status"[^>]*>${REASON}`));
		assert.doesNotMatch(html, /<p id="reason"[^>]*sr-only/);
		assert.match(html, /text-warning/);
	});
});
