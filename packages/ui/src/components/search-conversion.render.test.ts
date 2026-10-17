import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	droppedFacetsCopy,
	makeFilterBlockedCopy,
} from "./search-conversion.js";
import { SearchConversionNoticeView } from "./search-conversion-notice.js";

/** SSR splits interpolations with comment markers; sentences read across them. */
const render = (element: Parameters<typeof renderToString>[0]) =>
	renderToString(element).replaceAll("<!-- -->", "");

describe("search-conversion copy", () => {
	it("names one dropped facet in the singular", () => {
		const copy = droppedFacetsCopy(["Has attachment"]);
		assert.match(copy, /Has attachment isn't a filter condition/);
		assert.match(copy, /left out/);
	});

	it("joins several dropped facets and reads plural", () => {
		const copy = droppedFacetsCopy(["Has attachment", "Unread", "Before 2026"]);
		assert.match(copy, /Has attachment, Unread and Before 2026 aren't/);
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
	it("renders nothing when there is nothing to state", () => {
		const html = render(
			createElement(SearchConversionNoticeView, { notice: {} }),
		);
		assert.equal(html, "");
	});
});
