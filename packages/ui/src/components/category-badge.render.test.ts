import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { CategoryBadge, getCategoryLabel } from "./category-badge.js";

describe("getCategoryLabel", () => {
	it("returns null for undefined (no badge)", () => {
		assert.equal(getCategoryLabel(undefined), null);
	});

	it("returns null for 'personal' (default fallback, no badge)", () => {
		assert.equal(getCategoryLabel("personal"), null);
	});

	it("maps each non-personal category to its label", () => {
		assert.equal(getCategoryLabel("newsletter"), "newsletter");
		assert.equal(getCategoryLabel("marketing"), "marketing");
		assert.equal(getCategoryLabel("automated"), "notification");
		assert.equal(getCategoryLabel("transactional"), "receipt");
		assert.equal(getCategoryLabel("social"), "social");
	});
});

describe("CategoryBadge", () => {
	it("renders nothing for personal", () => {
		assert.equal(
			renderToString(createElement(CategoryBadge, { category: "personal" })),
			"",
		);
	});

	it("renders the label with an accessible category name", () => {
		const html = renderToString(
			createElement(CategoryBadge, { category: "newsletter" }),
		);
		assert.match(html, /newsletter/);
		assert.match(html, /aria-label="Category: newsletter"/);
	});
});
