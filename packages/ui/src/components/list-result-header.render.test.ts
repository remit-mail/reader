import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	ListResultHeader,
	type ListResultHeaderProps,
} from "./list-result-header.js";

const text = (props: ListResultHeaderProps): string =>
	renderToString(createElement(ListResultHeader, props)).replace(
		/<[^>]*>/g,
		"",
	);

describe("ListResultHeader", () => {
	it("states the server's total for the whole match set", () => {
		assert.equal(
			text({ query: "invoice", count: { kind: "exact", value: 1284 } }),
			`${(1284).toLocaleString()} results for “invoice”`,
		);
	});

	it("reads in the singular for one match", () => {
		assert.equal(
			text({ query: "invoice", count: { kind: "exact", value: 1 } }),
			"1 result for “invoice”",
		);
	});

	it("states a zero rather than dropping the number", () => {
		assert.equal(
			text({ query: "zzzz", count: { kind: "exact", value: 0 } }),
			"0 results for “zzzz”",
		);
	});

	it("renders no number at all when the count is unknown", () => {
		const rendered = text({ query: "invoice", count: { kind: "unknown" } });
		assert.equal(rendered, "Results for “invoice”");
		assert.doesNotMatch(rendered, /\d/);
	});
});
