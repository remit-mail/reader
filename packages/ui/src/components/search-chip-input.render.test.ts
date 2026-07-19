import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	SearchChipInput,
	type SearchChipInputProps,
} from "./search-chip-input.js";

const noop = () => {};

const render = (overrides: Partial<SearchChipInputProps> = {}): string =>
	renderToString(
		createElement(SearchChipInput, {
			value: "",
			onChange: noop,
			onClear: noop,
			...overrides,
		}),
	);

const SPAM = { id: "in:spam", label: "in:spam" };
const FROM = { id: "from:acme", label: "from:acme" };

describe("SearchChipInput", () => {
	it("renders a real text input with an accessible label", () => {
		const html = render({ placeholder: "Search mail" });
		assert.match(html, /aria-label="Search mail"/);
		assert.match(html, /placeholder="Search mail"/);
		assert.match(html, /value=""/);
	});

	it("renders one removable chip per narrowing term, in order", () => {
		const html = render({ chips: [SPAM, FROM] });
		assert.match(html, /in:spam/);
		assert.match(html, /from:acme/);
		assert.match(html, /aria-label="Remove filter: in:spam"/);
		assert.match(html, /aria-label="Remove filter: from:acme"/);
		assert.ok(
			html.indexOf("in:spam") < html.indexOf("from:acme"),
			"chips keep expression order",
		);
	});

	it("keeps chips and free text in the same field", () => {
		const html = render({ chips: [SPAM], value: "invoice" });
		assert.match(html, /in:spam/);
		assert.match(html, /value="invoice"/);
	});

	it("drops the placeholder once the expression carries a chip", () => {
		const html = render({ chips: [SPAM], placeholder: "Search mail" });
		assert.doesNotMatch(html, /placeholder="Search mail"/);
	});

	it("offers the clear control for a chip-only expression", () => {
		// A scope with no typed text is still a narrowed search — clearing must be
		// reachable without typing first.
		const html = render({ chips: [SPAM] });
		assert.match(html, /aria-label="Clear search"/);
	});

	it("omits the clear control while the expression is empty", () => {
		assert.doesNotMatch(render(), /aria-label="Clear search"/);
	});

	it("omits the inline clear when showClearButton is false", () => {
		const html = render({ value: "receipt", showClearButton: false });
		assert.doesNotMatch(html, /aria-label="Clear search"/);
		assert.match(html, /value="receipt"/);
	});

	it("exposes the chip's marked-for-deletion state as a toggle", () => {
		const html = render({ chips: [SPAM] });
		assert.match(html, /aria-pressed="false"/);
	});

	it("carries a live region for announcing the selected chip", () => {
		const html = render({ chips: [SPAM] });
		assert.match(html, /role="status"/);
		assert.match(html, /aria-live="polite"/);
	});

	it("renders the same field at either size", () => {
		for (const size of ["sm", "lg"] as const) {
			const html = render({ size, chips: [SPAM], value: "invoice" });
			assert.match(html, /aria-label="Search mail"/);
			assert.match(html, /in:spam/);
		}
	});

	it("takes a caller-supplied input id so a page can host more than one field", () => {
		assert.match(render({ inputId: "top-bar-search" }), /id="top-bar-search"/);
	});
});
