import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppPasswordHint } from "./app-password-hint.js";

describe("AppPasswordHint", () => {
	it("renders a deep link when a url is provided", () => {
		const html = renderToString(
			createElement(AppPasswordHint, {
				url: "https://support.apple.com/en-us/102654",
			}),
		);
		assert.match(html, /href="https:\/\/support\.apple\.com\/en-us\/102654"/);
		assert.match(html, /How to create an app password/);
	});

	it("renders the generic fallback when no url is provided", () => {
		const html = renderToString(createElement(AppPasswordHint, {}));
		assert.doesNotMatch(html, /<a /);
		assert.match(html, /Check your provider.*help for app password/);
	});
});
