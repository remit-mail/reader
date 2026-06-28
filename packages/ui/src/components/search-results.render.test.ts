import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { SearchResult } from "./search-result-row.js";
import { type SearchResultSection, SearchResults } from "./search-results.js";

const noop = () => {};

const result: SearchResult = {
	id: "r1",
	sender: "Stripe",
	subject: "Your invoice for March is ready",
	snippet: "Invoice #4821 paid.",
	date: "9:42",
};

const sections: SearchResultSection[] = [
	{ id: "results", label: "Results", results: [result] },
];

describe("SearchResults", () => {
	it("renders the section header and matching rows for a query", () => {
		const html = renderToString(
			createElement(SearchResults, { value: "invoice", sections }),
		);
		assert.match(html, /Results/);
		assert.match(html, /Stripe/);
		assert.match(html, /for March is ready/);
	});

	it("shows recent searches when the query is empty", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "",
				recentSearches: ["invoice march"],
				onPickRecent: noop,
			}),
		);
		assert.match(html, /Recent searches/);
		assert.match(html, /invoice march/);
	});

	it("shows the empty state when a query matches nothing", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "asdfqwer",
				sections: [{ id: "results", label: "Results", results: [] }],
			}),
		);
		assert.match(html, /No matches for/);
	});
});
