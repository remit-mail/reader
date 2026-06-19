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

	it("soft success keeps a status role and a real dismiss button, not a raw glyph", () => {
		const html = renderToString(
			createElement(
				Banner,
				{ tone: "success", variant: "soft", onDismiss: () => undefined },
				"Account connected successfully.",
			),
		);
		assert.match(html, /role="status"/);
		assert.match(html, /aria-label="Dismiss"/);
		assert.doesNotMatch(html, /✕/);
	});

	it("soft danger reports an alert role", () => {
		const html = renderToString(
			createElement(
				Banner,
				{ tone: "danger", variant: "soft" },
				"Sign-in failed.",
			),
		);
		assert.match(html, /role="alert"/);
	});
});
