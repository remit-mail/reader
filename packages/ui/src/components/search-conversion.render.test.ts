import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	DROPPED_SEMANTIC_COPY,
	droppedFacetsCopy,
	hasConversionNotice,
	makeFilterBlockedCopy,
	scopedOutCopy,
} from "./search-conversion.js";
import { SearchConversionNoticeView } from "./search-conversion-notice.js";

/** SSR splits interpolations with comment markers; sentences read across them. */
const render = (element: Parameters<typeof renderToString>[0]) =>
	renderToString(element).replaceAll("<!-- -->", "");

describe("search-conversion copy", () => {
	it("names the folder a scoped search is kept out of the filter for", () => {
		assert.match(scopedOutCopy("Archive"), /limited to Archive/);
		assert.match(scopedOutCopy("Archive"), /any folder/i);
	});

	it("names one dropped facet in the singular", () => {
		const copy = droppedFacetsCopy(["Has attachment"]);
		assert.match(copy, /Has attachment isn't a filter condition/);
		assert.match(copy, /left out/);
	});

	it("joins several dropped facets and reads plural", () => {
		const copy = droppedFacetsCopy(["Has attachment", "Unread", "Before 2026"]);
		assert.match(copy, /Has attachment, Unread and Before 2026 aren't/);
	});

	it("states the filter is literal-only and the reach is not carried", () => {
		assert.match(DROPPED_SEMANTIC_COPY, /matches these words literally/i);
		// Never claims the filter itself matches by meaning.
		assert.match(DROPPED_SEMANTIC_COPY, /a filter can't carry that/i);
	});

	it("has nothing to say when nothing was dropped", () => {
		assert.equal(hasConversionNotice({}), false);
		assert.equal(hasConversionNotice({ droppedSemantic: false }), false);
		assert.equal(hasConversionNotice({ droppedFacets: [] }), false);
	});

	it("has something to say for any single drop", () => {
		assert.equal(hasConversionNotice({ scopedOutFolder: "Archive" }), true);
		assert.equal(hasConversionNotice({ droppedFacets: ["Unread"] }), true);
		assert.equal(hasConversionNotice({ droppedSemantic: true }), true);
	});

	it("names the facets a chip-composed query is made of, not just the gap", () => {
		const copy = makeFilterBlockedCopy(["Unread", "Category: Newsletter"]);
		assert.match(
			copy,
			/Unread and Category: Newsletter aren't filter conditions/,
		);
		assert.match(copy, /add a sender or words to filter on/);
	});

	it("reads singular for one facet", () => {
		assert.match(
			makeFilterBlockedCopy(["Unread"]),
			/^Unread isn't a filter condition — /,
		);
	});

	it("asks for what is missing when no facet is what is in the way", () => {
		assert.equal(
			makeFilterBlockedCopy([]),
			"Add a sender or words to filter on",
		);
	});
});

describe("SearchConversionNoticeView", () => {
	it("renders every drop the conversion recorded", () => {
		const html = render(
			createElement(SearchConversionNoticeView, {
				notice: {
					scopedOutFolder: "Archive",
					droppedFacets: ["Has attachment"],
					droppedSemantic: true,
				},
			}),
		);
		assert.match(html, /From your search/);
		assert.match(html, /limited to Archive/);
		assert.match(html, /Has attachment/);
		assert.match(html, /left out/);
		assert.match(html, /matches these words literally/i);
	});

	it("renders nothing when there is nothing to state", () => {
		const html = render(
			createElement(SearchConversionNoticeView, { notice: {} }),
		);
		assert.equal(html, "");
	});
});
