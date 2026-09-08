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

	it("offers 'Make this a filter' above active results", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections,
				makeFilter: { onClick: noop },
			}),
		);
		assert.match(html, /Make this a filter/);
		assert.doesNotMatch(html, /disabled=""/);
	});

	it("keeps the filter offer pressable when nothing converts, carrying its reason", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "has:attachment",
				sections: [{ id: "results", label: "Results", results: [] }],
				makeFilter: { onClick: noop, blockedReason: "Add a sender or words" },
			}),
		);
		assert.match(html, /Make this a filter/);
		assert.doesNotMatch(html, /disabled/);
		assert.match(html, /aria-describedby/);
		assert.match(html, /Add a sender or words/);
	});

	it("never offers the filter on the empty-query recent-searches view", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "",
				recentSearches: ["invoice"],
				makeFilter: { onClick: noop },
			}),
		);
		assert.doesNotMatch(html, /Make this a filter/);
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
	it("holds spam out of a global search and offers the caller's count", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: mixed,
				scope: {
					kind: "global",
					onScopeToSpam: noop,
					spamCount: { kind: "exact", value: 1 },
				},
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
				scope: { kind: "global", onScopeToSpam: noop },
			}),
		);
		assert.doesNotMatch(html, /from Spam/);
	});

	it("offers spam above the empty state when every match is spam", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: [{ id: "results", label: "Results", results: [spamResult] }],
				scope: {
					kind: "global",
					onScopeToSpam: noop,
					spamCount: { kind: "exact", value: 1 },
				},
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
								folder: {
									providerPath: "Projects/Books",
									hierarchyDelimiter: "/",
								},
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
								folder: {
									providerPath: "[Gmail]/Important",
									hierarchyDelimiter: "/",
								},
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

describe("SearchResults scoped to a collection", () => {
	const spamRow: SearchResult = {
		id: "s1",
		sender: "billing@unknown-vendor.test",
		subject: "URGENT invoice attached",
		snippet: "Wire the amount below.",
		date: "Feb 11",
		folder: { role: "junk" },
	};
	const archivedRow: SearchResult = {
		...result,
		id: "a1",
		folder: { role: "archive" },
	};
	const collectionSections: SearchResultSection[] = [
		{ id: "results", label: "Results", results: [archivedRow, spamRow] },
	];

	it("keeps a starred spam match in the list", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: collectionSections,
				scope: { kind: "collection" },
			}),
		);
		assert.match(html, /billing@unknown-vendor\.test/);
		assert.doesNotMatch(html, /from Spam/);
	});

	it("still names the folder each row came from", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: collectionSections,
				scope: { kind: "collection" },
			}),
		);
		assert.match(html, /Archive/);
		assert.match(html, /Spam/);
	});

	it("holds the same spam row out when the search is scoped to a folder", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: collectionSections,
				scope: { kind: "folder", role: "inbox" },
			}),
		);
		assert.doesNotMatch(html, /billing@unknown-vendor\.test/);
	});
});

// #313: the figure used to be the junk rows in `sections` — a count of the page
// the caller had loaded, stated as a count of a mailbox. The caller supplies the
// server's count now, and this component never invents one.
describe("SearchResults spam count", () => {
	const spamIn = (id: string): SearchResult => ({
		id,
		sender: "spammer",
		subject: "Offer",
		snippet: "",
		date: "",
		folder: { role: "junk" },
	});

	const withSpamRows = [
		{
			id: "results",
			label: "Results",
			results: [result, spamIn("a1"), spamIn("b1"), spamIn("b2")],
		},
	];

	it("states the count it was given, not the rows it held out", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: withSpamRows,
				scope: {
					kind: "global",
					onScopeToSpam: noop,
					spamCount: { kind: "exact", value: 41 },
				},
			}),
		);
		assert.match(html, />41</);
		assert.match(html, /results from Spam/);
		assert.doesNotMatch(html, />3</);
	});

	it("names no figure when the caller has no count", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: withSpamRows,
				scope: { kind: "global", onScopeToSpam: noop },
			}),
		);
		assert.match(html, /Results from Spam/);
		// The counted form is lower-case ("3 results from Spam"), so its absence is
		// the absence of a figure rather than of one particular value.
		assert.doesNotMatch(html, /results from Spam/);
	});

	// The count answers over the whole junk scope, so an exact zero settles it
	// even where a stale row on this page says otherwise.
	it("makes no offer when the count is an exact zero", () => {
		const html = renderToString(
			createElement(SearchResults, {
				value: "invoice",
				sections: withSpamRows,
				scope: {
					kind: "global",
					onScopeToSpam: noop,
					spamCount: { kind: "exact", value: 0 },
				},
			}),
		);
		assert.doesNotMatch(html, /from Spam/);
	});
});
