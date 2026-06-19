import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AuthHero } from "./auth-hero.js";

describe("AuthHero", () => {
	it("renders the default wordmark, tagline, and envelope mark", () => {
		const html = renderToString(createElement(AuthHero));
		assert.match(html, /remit,/);
		assert.match(html, /your email client in the cloud\./);
		assert.match(html, /<svg/);
	});

	it("renders custom wordmark and tagline", () => {
		const html = renderToString(
			createElement(AuthHero, {
				wordmark: "acme,",
				tagline: "mail, reimagined.",
			}),
		);
		assert.match(html, /acme,/);
		assert.match(html, /mail, reimagined\./);
	});

	it("is NOT wrapped in an Amplify router slot — it floats above the card", () => {
		const html = renderToString(createElement(AuthHero));
		assert.doesNotMatch(html, /data-amplify-router/);
		assert.doesNotMatch(html, /data-amplify/);
	});
});
