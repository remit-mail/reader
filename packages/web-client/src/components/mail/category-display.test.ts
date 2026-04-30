import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCategoryLabel } from "./category-display.js";

describe("getCategoryLabel", () => {
	it("returns null for undefined (no badge)", () => {
		assert.equal(getCategoryLabel(undefined), null);
	});

	it("returns null for 'personal' (default fallback, no badge)", () => {
		assert.equal(getCategoryLabel("personal"), null);
	});

	it("returns 'newsletter' for newsletter", () => {
		assert.equal(getCategoryLabel("newsletter"), "newsletter");
	});

	it("returns 'marketing' for marketing", () => {
		assert.equal(getCategoryLabel("marketing"), "marketing");
	});

	it("returns 'notification' for automated", () => {
		assert.equal(getCategoryLabel("automated"), "notification");
	});

	it("returns 'receipt' for transactional", () => {
		assert.equal(getCategoryLabel("transactional"), "receipt");
	});

	it("returns 'social' for social", () => {
		assert.equal(getCategoryLabel("social"), "social");
	});
});
