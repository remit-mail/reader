import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FilterSheet, type FilterSheetProps } from "./filter-sheet.js";

const categories = [
	{ id: "all", label: "All", tone: "neutral" as const },
	{ id: "personal", label: "Personal", tone: "positive" as const },
];

const filters = [
	{ id: "unread", label: "Unread" },
	{ id: "today", label: "Today" },
];

const sources = [
	{ id: "all", label: "All", active: true },
	{ id: "work", label: "work@acme.com", count: 12 },
];

function render(overrides: Partial<FilterSheetProps> = {}): string {
	return renderToString(
		createElement(FilterSheet, {
			categories,
			filters,
			sources,
			selectedCategory: "all",
			activeFilters: new Set<string>(),
			onSelectCategory: () => undefined,
			onSelectSource: () => undefined,
			onToggleFilter: () => undefined,
			onClear: () => undefined,
			onExpandedChange: () => undefined,
			...overrides,
		}),
	);
}

describe("FilterSheet", () => {
	it("collapsed shows the Filters bar and an expand caret", () => {
		const html = render({ expanded: false });
		assert.match(html, /Filters/);
		assert.match(html, /aria-label="Expand filters"/);
		assert.match(html, /aria-expanded="false"/);
	});

	it("collapsed does not render the filter rows", () => {
		const html = render({ expanded: false });
		assert.doesNotMatch(html, /work@acme\.com/);
		assert.doesNotMatch(html, /Today/);
	});

	it("expanded renders category, filter, and source rows", () => {
		const html = render({ expanded: true });
		assert.match(html, /aria-label="Collapse filters"/);
		assert.match(html, /Personal/);
		assert.match(html, /Today/);
		assert.match(html, /work@acme\.com/);
	});

	it("renders a clear control when a filter is active", () => {
		const html = render({
			expanded: true,
			activeFilters: new Set(["unread"]),
		});
		assert.match(html, /aria-label="Clear filters"/);
	});

	it("is flat: no overlay, scrim, shadow, or rounded-corner chrome", () => {
		const html = render({ expanded: true });
		assert.doesNotMatch(html, /shadow-/);
		assert.doesNotMatch(html, /rounded-b-2xl/);
		assert.doesNotMatch(html, /role="slider"/);
	});
});
