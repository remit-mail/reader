import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SpamResultsOffer } from "./spam-results-offer.js";

const noop = () => {};

describe("SpamResultsOffer", () => {
	it("states the count and offers a way into Spam", () => {
		const html = renderToString(
			createElement(SpamResultsOffer, {
				count: { kind: "exact", value: 3 },
				onScopeToSpam: noop,
			}),
		);
		assert.match(html, />3</);
		assert.match(html, /results from Spam/);
		assert.match(html, /Go to Spam/);
	});

	it("reads in the singular for one match", () => {
		const html = renderToString(
			createElement(SpamResultsOffer, {
				count: { kind: "exact", value: 1 },
				onScopeToSpam: noop,
			}),
		);
		assert.match(html, /result from Spam/);
		assert.doesNotMatch(html, /results from Spam/);
	});

	it("names no figure when the junk folders went uncounted", () => {
		const html = renderToString(
			createElement(SpamResultsOffer, {
				count: { kind: "unknown" },
				onScopeToSpam: noop,
			}),
		);
		assert.match(html, /Results from Spam/);
		// The figure is the only tabular-nums span the banner renders, so its
		// absence is the absence of a number rather than of one particular value.
		assert.doesNotMatch(html, /tabular-nums/);
		assert.match(html, /Go to Spam/);
	});
});
