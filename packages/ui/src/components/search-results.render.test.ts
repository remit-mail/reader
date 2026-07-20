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

	it("renders the matched-chunk chip and score on a semantic hit", () => {
		const semanticResult: SearchResult = {
			...result,
			matchedChunkLabel: "subject",
			score: 0.87,
		};
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: [
					{ id: "related", label: "Related", results: [semanticResult] },
				],
			}),
		);
		assert.match(html, /matched: subject/);
		assert.match(html, /0\.87/);
	});

	it("renders removable filter-token chips above the sections", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice from:stripe.com",
				sections,
				tokens: [{ label: "From: stripe.com", onRemove: noop }],
			}),
		);
		assert.match(html, /From: stripe\.com/);
	});

	it("omits the chip row when there are no tokens", () => {
		const html = renderToString(
			createElement(SearchResults, { value: "invoice", sections, tokens: [] }),
		);
		assert.doesNotMatch(html, /Remove filter/);
	});
});

const spamResult: SearchResult = {
	id: "s1",
	sender: "billing@unknown-vendor.test",
	subject: "URGENT invoice attached",
	snippet: "Wire the amount below.",
	date: "Feb 11",
	folder: { role: "junk" },
};

const archivedResult: SearchResult = {
	...result,
	id: "a1",
	sender: "Mollie",
	folder: { role: "archive" },
};

const mixed: SearchResultSection[] = [
	{ id: "results", label: "Results", results: [archivedResult, spamResult] },
];

describe("SearchResults spam handling", () => {
	it("holds spam out of a global search and offers it as a count", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: mixed,
				scope: { kind: "global" },
				onScopeToSpam: noop,
			}),
		);
		assert.doesNotMatch(html, /unknown-vendor/);
		assert.match(html, /result from Spam/);
		assert.match(html, /Mollie/);
	});

	it("makes no offer when a global search found nothing in spam", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: [
					{ id: "results", label: "Results", results: [archivedResult] },
				],
				scope: { kind: "global" },
				onScopeToSpam: noop,
			}),
		);
		assert.doesNotMatch(html, /from Spam/);
	});

	it("offers spam above the empty state when every match is spam", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: [{ id: "results", label: "Results", results: [spamResult] }],
				scope: { kind: "global" },
				onScopeToSpam: noop,
			}),
		);
		assert.match(html, /No matches for/);
		assert.match(html, /result from Spam/);
	});

	it("shows neither spam rows nor an offer when scoped elsewhere", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: mixed,
				scope: { kind: "folder", role: "inbox" },
				onScopeToSpam: noop,
			}),
		);
		assert.doesNotMatch(html, /unknown-vendor/);
		assert.doesNotMatch(html, /from Spam/);
		assert.match(html, /Mollie/);
	});

	it("renders spam rows normally and makes no offer when scoped to spam", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: mixed,
				scope: { kind: "folder", role: "junk" },
				onScopeToSpam: noop,
			}),
		);
		assert.match(html, /unknown-vendor/);
		assert.doesNotMatch(html, /from Spam/);
	});

	it("makes no offer without a way to scope to spam", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: mixed,
				scope: { kind: "global" },
			}),
		);
		assert.doesNotMatch(html, /from Spam/);
	});

	it("prefers a caller-supplied total over the rows held out of this page", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: mixed,
				scope: { kind: "global" },
				spamMatchCount: 42,
				onScopeToSpam: noop,
			}),
		);
		assert.match(html, />42</);
	});
});

describe("SearchResults provenance labels", () => {
	it("names the folder each row came from in a global search", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: [
					{
						id: "results",
						label: "Results",
						results: [
							archivedResult,
							{
								...result,
								id: "c1",
								folder: { providerPath: "Projects/Books" },
							},
						],
					},
				],
				scope: { kind: "global" },
			}),
		);
		assert.match(html, /Archive/);
		assert.match(html, /Books/);
	});

	it("drops the labels when the search is scoped to one folder", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: [
					{ id: "results", label: "Results", results: [archivedResult] },
				],
				scope: { kind: "folder", role: "archive" },
			}),
		);
		assert.doesNotMatch(html, /Archive/);
	});

	it("leaves a row from a view rather than a folder unlabelled", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: [
					{
						id: "results",
						label: "Results",
						results: [
							{ ...result, id: "v1", folder: { role: "all" } },
							{ ...result, id: "v2", folder: { role: "flagged" } },
							{
								...result,
								id: "v3",
								folder: { providerPath: "[Gmail]/Important" },
							},
						],
					},
				],
				scope: { kind: "global" },
			}),
		);
		assert.doesNotMatch(html, /All Mail/);
		assert.doesNotMatch(html, /Starred/);
		assert.doesNotMatch(html, /Important/);
	});
});
