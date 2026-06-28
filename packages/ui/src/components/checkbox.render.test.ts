import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Checkbox } from "./checkbox.js";

const noop = () => {};

describe("Checkbox", () => {
	it("renders a real checkbox input", () => {
		const html = renderToString(
			createElement(Checkbox, {
				"aria-label": "Select row",
				checked: false,
				onChange: noop,
			}),
		);
		assert.match(html, /type="checkbox"/);
		assert.match(html, /aria-label="Select row"/);
	});

	it("reflects the checked state on the input", () => {
		const checked = renderToString(
			createElement(Checkbox, {
				"aria-label": "x",
				checked: true,
				onChange: noop,
			}),
		);
		assert.match(checked, /checked=""/);

		const unchecked = renderToString(
			createElement(Checkbox, {
				"aria-label": "x",
				checked: false,
				onChange: noop,
			}),
		);
		assert.doesNotMatch(unchecked, /checked=""/);
	});

	it("wraps in a label with the touch target when given label text", () => {
		const html = renderToString(
			createElement(Checkbox, {
				label: "Keep me posted",
				checked: false,
				onChange: noop,
			}),
		);
		assert.match(html, /<label/);
		assert.match(html, /min-h-11/);
		assert.match(html, /Keep me posted/);
	});

	it("renders just the control when label and description are omitted", () => {
		const html = renderToString(
			createElement(Checkbox, {
				"aria-label": "bare",
				checked: false,
				onChange: noop,
			}),
		);
		assert.doesNotMatch(html, /<label/);
	});
});
