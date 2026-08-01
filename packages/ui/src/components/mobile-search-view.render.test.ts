import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FilterPanelProvider } from "./filter-sheet.js";
import { MobileSearchView } from "./mobile-search-view.js";
import type { SearchResult } from "./search-result-row.js";

const noop = () => {};

const archived: SearchResult = {
	id: "a1",
	sender: "Mollie",
	subject: "Invoice 2026-02",
	snippet: "Payment already settled.",
	date: "Feb 24",
	folder: { role: "archive" },
};

const spam: SearchResult = {
	id: "s1",
	sender: "billing@unknown-vendor.test",
	subject: "URGENT invoice attached",
	snippet: "Wire the amount below.",
	date: "Feb 11",
	folder: { role: "junk" },
};

const sections = [
	{ id: "top", label: "Top matches", results: [archived, spam] },
];

const base = {
	value: "invoice",
	onChange: noop,
	onClear: noop,
	onCancel: noop,
	sections,
};

const filter = {
	categories: [{ id: "all", label: "All" }],
	filters: [{ id: "unread", label: "Unread" }],
	selectedCategory: "all",
	activeFilters: new Set<string>(),
	onSelectCategory: noop,
	onToggleFilter: noop,
	onClear: noop,
};

describe("MobileSearchView filter chrome", () => {
	it("gives the filter row up to the search once a query is typed", () => {
		const html = renderToString(
			createElement(MobileSearchView, { ...base, filter }),
		);
		assert.doesNotMatch(html, /Expand filters/);
	});

	it("keeps the filter row while the field is empty", () => {
		const html = renderToString(
			createElement(MobileSearchView, {
				...base,
				value: "",
				sections: [],
				filter,
			}),
		);
		assert.match(html, /Expand filters/);
	});

	// The takeover covers the list whose header carries the caret, so it cannot
	// borrow that caret: it renders over the header, not under it. Without the
	// boundary the sheet reads the list's panel and drops its own trigger row,
	// leaving the takeover with no way to open its filters at all.
	it("keeps its own filter row over a list that has a filter panel", () => {
		const html = renderToString(
			createElement(
				FilterPanelProvider,
				{ hasSheet: true },
				createElement(MobileSearchView, {
					...base,
					value: "",
					sections: [],
					filter,
				}),
			),
		);
		assert.match(html, /Expand filters/);
	});
});

describe("MobileSearchView search scope", () => {
	it("offers held-out spam on the phone tier too", () => {
		const html = renderToString(
			createElement(MobileSearchView, {
				...base,
				scope: { kind: "global" as const, onScopeToSpam: noop },
			}),
		);
		assert.doesNotMatch(html, /unknown-vendor/);
		assert.match(html, /result from Spam/);
		assert.match(html, /Archive/);
	});

	it("shows neither spam nor provenance labels when scoped", () => {
		const html = renderToString(
			createElement(MobileSearchView, {
				...base,
				scope: { kind: "folder" as const, role: "inbox" as const },
			}),
		);
		assert.doesNotMatch(html, /unknown-vendor/);
		assert.doesNotMatch(html, /from Spam/);
		assert.doesNotMatch(html, /Archive/);
	});

	it("counts the spam it held out, on the phone tier too", () => {
		const html = renderToString(
			createElement(MobileSearchView, {
				...base,
				scope: { kind: "global" as const, onScopeToSpam: noop },
			}),
		);
		assert.match(html, /from Spam/);
		assert.match(html, /Go to Spam/);
	});
});
