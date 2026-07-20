import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ProgressBar } from "./progress-bar.js";

describe("ProgressBar", () => {
	it("renders progressbar role with the aria value triad", () => {
		const html = renderToString(
			createElement(ProgressBar, { value: 1200, max: 3412 }),
		);
		assert.match(html, /role="progressbar"/);
		assert.match(html, /aria-valuenow="1200"/);
		assert.match(html, /aria-valuemin="0"/);
		assert.match(html, /aria-valuemax="3412"/);
	});

	it("computes the fill width as a percentage of value/max", () => {
		const html = renderToString(
			createElement(ProgressBar, { value: 25, max: 100 }),
		);
		assert.match(html, /width:25%/);
	});

	it("clamps the fill at 100% when value exceeds max", () => {
		const html = renderToString(
			createElement(ProgressBar, { value: 500, max: 100 }),
		);
		assert.match(html, /width:100%/);
	});

	it("omits the aria value triad when indeterminate", () => {
		const html = renderToString(
			createElement(ProgressBar, { value: 0, max: 0, indeterminate: true }),
		);
		assert.doesNotMatch(html, /aria-valuenow/);
		assert.doesNotMatch(html, /aria-valuemax/);
	});

	it("applies the tone's fill color", () => {
		const html = renderToString(
			createElement(ProgressBar, { value: 1, max: 2, tone: "danger" }),
		);
		assert.match(html, /bg-danger/);
	});
});
