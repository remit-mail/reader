import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toDisplayCategory } from "./display-category.js";

describe("toDisplayCategory", () => {
	test("shows an unclassified message as unclassified, not personal", () => {
		// Collapsing `uncategorized` into `personal` made "the classifier never
		// ran" indistinguishable from "the classifier decided this is personal"
		// (issue #45).
		assert.strictEqual(toDisplayCategory("uncategorized"), "uncategorized");
	});

	test("treats a row with no category as unclassified", () => {
		assert.strictEqual(toDisplayCategory(undefined), "uncategorized");
	});

	test("passes every classified category through unchanged", () => {
		for (const category of [
			"personal",
			"newsletter",
			"marketing",
			"automated",
			"transactional",
			"social",
		] as const) {
			assert.strictEqual(toDisplayCategory(category), category);
		}
	});
});
