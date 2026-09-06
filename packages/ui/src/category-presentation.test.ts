import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CATEGORY_PRESENTATION,
	CATEGORY_SECTION_ORDER,
	categoryChips,
	categoryLabels,
	categoryTone,
} from "./category-presentation.js";

// Written out rather than derived: the table is the only definition of these
// words and this order, so a test that reads them back from it agrees with any
// rename. A reader who has learnt "Unclassified" should not meet a new word
// because an edit here went unnoticed.
describe("the canonical category table", () => {
	it("gives every category the word every surface shows", () => {
		assert.deepEqual(categoryLabels, {
			personal: "Personal",
			uncategorized: "Unclassified",
			transactional: "Transactional",
			newsletter: "Newsletter",
			marketing: "Marketing",
			social: "Social",
			automated: "Automated",
		});
	});

	it("gives every category its tone, and does not warn about marketing", () => {
		assert.deepEqual(categoryTone, {
			personal: "accent",
			uncategorized: "neutral",
			transactional: "positive",
			newsletter: "neutral",
			marketing: "neutral",
			social: "warning",
			automated: "neutral",
		});
	});

	it("ends the brief's section order with the unclassified mail", () => {
		assert.deepEqual(CATEGORY_SECTION_ORDER, [
			"personal",
			"transactional",
			"newsletter",
			"marketing",
			"social",
			"automated",
			"uncategorized",
		]);
	});

	it("leads the chip row with All, then Personal and Unclassified", () => {
		assert.deepEqual(
			categoryChips.map((chip) => chip.label),
			[
				"All",
				"Personal",
				"Unclassified",
				"Transactional",
				"Newsletter",
				"Marketing",
				"Social",
				"Automated",
			],
		);
	});

	it("gives each category one row, and each section one place", () => {
		const categories = CATEGORY_PRESENTATION.map((entry) => entry.category);
		assert.equal(new Set(categories).size, categories.length);
		assert.deepEqual(
			CATEGORY_PRESENTATION.map((entry) => entry.section).sort((a, b) => a - b),
			[1, 2, 3, 4, 5, 6, 7],
		);
	});
});
