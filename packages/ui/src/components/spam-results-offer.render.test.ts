import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SpamResultsOffer } from "./spam-results-offer.js";

const noop = () => {};

describe("SpamResultsOffer", () => {
	it("states the count and offers a way into Spam", () => {
		const html = renderToString(
			createElement(SpamResultsOffer, { count: 3, onScopeToSpam: noop }),
		);
		assert.match(html, /3/);
		assert.match(html, /results from Spam/);
		assert.match(html, /View them/);
	});

	it("reads in the singular for one match", () => {
		const html = renderToString(
			createElement(SpamResultsOffer, { count: 1, onScopeToSpam: noop }),
		);
		assert.match(html, /result from Spam/);
		assert.doesNotMatch(html, /results from Spam/);
	});
});
