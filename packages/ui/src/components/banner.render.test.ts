import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Banner } from "./banner.js";

describe("Banner", () => {
	it("renders content with an alert role", () => {
		const html = renderToString(
			createElement(Banner, { tone: "warning" }, "heads up"),
		);
		assert.match(html, /role="alert"/);
		assert.match(html, /heads up/);
	});

	it("applies the warning tone classes", () => {
		const html = renderToString(
			createElement(Banner, { tone: "warning" }, "x"),
		);
		assert.match(html, /text-warning/);
	});

	it("renders a dismiss button only when onDismiss is supplied", () => {
		const withDismiss = renderToString(
			createElement(Banner, { tone: "info", onDismiss: () => undefined }, "x"),
		);
		assert.match(withDismiss, /aria-label="Dismiss"/);

		const withoutDismiss = renderToString(
			createElement(Banner, { tone: "info" }, "x"),
		);
		assert.doesNotMatch(withoutDismiss, /aria-label="Dismiss"/);
	});
});
