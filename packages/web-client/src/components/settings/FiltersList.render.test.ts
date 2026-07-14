import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FiltersList } from "./FiltersList";

// The node test loader transpiles remit-ui's `.tsx` with the classic JSX
// runtime, which references a global `React`. Vite uses the automatic runtime,
// so this shim only exists for the SSR test harness.
(globalThis as { React?: typeof React }).React = React;

const NOW = Date.parse("2026-07-12T12:00:00Z");

const filter = (
	overrides: Partial<RemitImapFilterResponse>,
): RemitImapFilterResponse => ({
	filterId: "f-1",
	accountConfigId: "acc-1",
	name: "Travel",
	scope: "Standing",
	state: "Active",
	hasAnchor: true,
	ruleChangedAt: 0,
	matchOperator: "And",
	literalClauses: [],
	actionLabelId: "None",
	actionMailboxId: "mbx-travel",
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

const render = (filters: RemitImapFilterResponse[]) =>
	renderToString(
		createElement(FiltersList, {
			filters,
			mailboxName: (id: string) => (id === "mbx-travel" ? "Travel" : undefined),
			onDelete: () => undefined,
			now: NOW,
		}) as never,
	);

describe("FiltersList", () => {
	it("renders the empty state with a pointer to Organize", () => {
		const html = render([]);
		assert.match(html, /No filters yet/);
	});

	it("marks a standing filter Active and shows its move target", () => {
		const html = render([filter({})]);
		assert.match(html, /Active/);
		assert.match(html, /Moves matches to Travel/);
		assert.match(html, /always/);
	});

	it("keeps an expired temporary filter visible and marks it Expired (RFC 034 Decision 1.2)", () => {
		const html = render([
			filter({
				filterId: "f-2",
				name: "Lisbon trip",
				scope: "Temporary",
				state: "Active",
				expiresAt: "2026-07-10T00:00:00Z",
			}),
		]);
		assert.match(html, /Lisbon trip/);
		assert.match(html, /Expired/);
		assert.match(html, /expired/);
	});
});
