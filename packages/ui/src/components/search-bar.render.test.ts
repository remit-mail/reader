import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SearchBar } from "./search-bar.js";

const noop = () => {};

describe("SearchBar", () => {
	it("renders the search input with an accessible label and placeholder", () => {
		const html = renderToString(
			createElement(SearchBar, {
				value: "",
				onChange: noop,
				onClear: noop,
				placeholder: "Search mail",
			}),
		);
		assert.match(html, /aria-label="Search mail"/);
		assert.match(html, /placeholder="Search mail"/);
		assert.match(html, /value=""/);
	});

	it("omits the clear button while the query is empty", () => {
		const html = renderToString(
			createElement(SearchBar, { value: "", onChange: noop, onClear: noop }),
		);
		assert.doesNotMatch(html, /aria-label="Clear search"/);
	});

	it("shows the clear button once a query is present", () => {
		const html = renderToString(
			createElement(SearchBar, {
				value: "receipt",
				onChange: noop,
				onClear: noop,
			}),
		);
		assert.match(html, /aria-label="Clear search"/);
		assert.match(html, /value="receipt"/);
	});

	it("omits the inline clear button when showClearButton is false", () => {
		const html = renderToString(
			createElement(SearchBar, {
				value: "receipt",
				onChange: noop,
				onClear: noop,
				showClearButton: false,
			}),
		);
		assert.doesNotMatch(html, /aria-label="Clear search"/);
		assert.match(html, /value="receipt"/);
	});
});
