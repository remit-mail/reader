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

const render = (open: boolean) =>
	renderToString(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			createElement(SearchFilterDialog, {
				open,
				accountId: "acc-1",
				parsed: parseSearchTokens("receipts", {}),
				probeMessageId: "msg-1",
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
});
