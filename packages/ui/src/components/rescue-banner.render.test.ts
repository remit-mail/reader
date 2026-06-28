import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RescueBanner } from "./rescue-banner.js";

const noop = () => {};

describe("RescueBanner", () => {
	it("states the count in plain language and offers the action", () => {
		const html = renderToString(
			createElement(RescueBanner, { count: 5, onReview: noop }),
		);
		assert.match(html, /5 messages here/);
		assert.match(html, /senders we can verify/);
		assert.match(html, /Review &amp; rescue/);
	});

	it("uses the singular form for one message", () => {
		const html = renderToString(
			createElement(RescueBanner, { count: 1, onReview: noop }),
		);
		assert.match(html, /1 message here/);
	});

	it("never leaks authentication jargon", () => {
		const html = renderToString(
			createElement(RescueBanner, { count: 3, onReview: noop }),
		);
		assert.doesNotMatch(html, /DKIM|SPF|DMARC|spam score/i);
	});
});
