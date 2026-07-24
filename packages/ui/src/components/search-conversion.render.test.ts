import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	DROPPED_SEMANTIC_COPY,
	droppedFacetsCopy,
	hasConversionNotice,
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

	it("makes no similarity claim in the dropped-semantic copy", () => {
		assert.doesNotMatch(DROPPED_SEMANTIC_COPY, /similar/i);
		assert.match(DROPPED_SEMANTIC_COPY, /can't match mail by meaning/i);
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
		assert.match(html, /match mail by meaning/i);
	});

	it("renders nothing when there is nothing to state", () => {
		const html = render(
			createElement(SearchConversionNoticeView, { notice: {} }),
		);
		assert.equal(html, "");
	});
});
