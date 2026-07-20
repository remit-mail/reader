import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
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

describe("MobileSearchView search scope", () => {
	it("offers held-out spam on the phone tier too", () => {
		const html = renderToString(
			createElement(MobileSearchView, {
				...base,
				scope: { kind: "global" as const },
				onScopeToSpam: noop,
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
				onScopeToSpam: noop,
			}),
		);
		assert.doesNotMatch(html, /unknown-vendor/);
		assert.doesNotMatch(html, /from Spam/);
		assert.doesNotMatch(html, /Archive/);
	});

	it("passes a caller-supplied spam total through", () => {
		const html = renderToString(
			createElement(MobileSearchView, {
				...base,
				scope: { kind: "global" as const },
				spamMatchCount: 42,
				onScopeToSpam: noop,
			}),
		);
		assert.match(html, />42</);
	});
});
