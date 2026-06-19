import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AuthCard } from "./auth-card.js";

describe("AuthCard", () => {
	it("carries data-auth-page so the Amplify overrides apply", () => {
		const html = renderToString(createElement(AuthCard, null, "form"));
		assert.match(html, /data-auth-page/);
	});

	it("renders the radial-gradient page frame", () => {
		const html = renderToString(createElement(AuthCard, null, "form"));
		assert.match(html, /radial-gradient/);
		assert.match(html, /min-h-dvh/);
	});

	it("centres a max-width card column around its children", () => {
		const html = renderToString(createElement(AuthCard, null, "SIGNIN"));
		assert.match(html, /max-w-\[26rem\]/);
		assert.match(html, /SIGNIN/);
	});
});
