import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { getCategoryLabel } from "../category-presentation.js";
import { CategoryBadge } from "./category-badge.js";

describe("getCategoryLabel", () => {
	it("returns null for 'personal' (default fallback, no badge)", () => {
		assert.equal(getCategoryLabel("personal"), null);
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
		assert.match(html, /Newsletter/);
		assert.match(html, /aria-label="Category: Newsletter"/);
	});
});
