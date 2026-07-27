import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { parseSearchTokens } from "@/lib/search-tokens";
import { SearchFilterDialog } from "./SearchFilterDialog";

// The node test loader transpiles remit-ui's `.tsx` with the classic JSX
// runtime, which references a global `React`.
(globalThis as { React?: typeof React }).React = React;

const render = (open: boolean, query = "from:receipts@stripe.com") =>
	renderToString(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			createElement(SearchFilterDialog, {
				open,
				accountId: "acc-1",
				parsed: parseSearchTokens(query, {}),
				searchHadSemanticReach: true,
				onClose: () => undefined,
			}),
		) as never,
	);

describe("SearchFilterDialog", () => {
	it("renders nothing when closed", () => {
		assert.equal(render(false), "");
	});

	it("shows the conversion step while the seed preview is in flight", () => {
		assert.match(render(true), /Turning your search into a filter/);
	});

	it("opens the editor for a free-text search instead of failing to count it", () => {
		// The free text converts to a `HasWords` clause, which the vector-free
		// matcher refuses outright. Asking for a count is a 500, so nothing is
		// asked: the editor opens and the count region carries the reason.
		const html = render(true, "receipts");
		assert.doesNotMatch(html, /Turning your search into a filter/);
		assert.doesNotMatch(html, /Couldn't build the filter/);
		assert.match(html, /These chips are the whole rule/);
		assert.match(html, /reads message bodies/);
	});
});
