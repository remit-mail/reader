import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Button } from "./button.js";

describe("Button", () => {
	it("defaults to the md size", () => {
		const html = renderToString(createElement(Button, {}, "Save"));
		assert.match(html, /h-9/);
		assert.doesNotMatch(html, /h-11/);
	});

	it("renders the sm size at 28px", () => {
		const html = renderToString(createElement(Button, { size: "sm" }, "Save"));
		assert.match(html, /h-7/);
	});

	it("renders the touch size at 44px square", () => {
		const html = renderToString(
			createElement(Button, {
				size: "touch",
				"aria-label": "Delete",
			}),
		);
		assert.match(html, /h-11/);
		assert.match(html, /w-11/);
	});
});
