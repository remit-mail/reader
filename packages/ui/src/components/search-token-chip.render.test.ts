import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SearchTokenChip, SearchTokenChips } from "./search-token-chip.js";

const noop = () => {};

describe("SearchTokenChip", () => {
	it("renders the label and a remove control", () => {
		const html = renderToString(
			createElement(SearchTokenChip, {
				label: "Has attachment",
				onRemove: noop,
			}),
		);
		assert.match(html, /Has attachment/);
		assert.match(html, /aria-label="Remove filter: Has attachment"/);
	});
});

describe("SearchTokenChips", () => {
	it("renders nothing for an empty token list", () => {
		assert.equal(
			renderToString(createElement(SearchTokenChips, { tokens: [] })),
			"",
		);
	});

	it("renders one chip per token", () => {
		const html = renderToString(
			createElement(SearchTokenChips, {
				tokens: [
					{ label: "Unread", onRemove: noop },
					{ label: "From: alice", onRemove: noop },
				],
			}),
		);
		assert.match(html, /Unread/);
		assert.match(html, /From: alice/);
	});
});
