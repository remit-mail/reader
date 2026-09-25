import assert from "node:assert";
import { describe, test } from "node:test";
import { calendarUrlSegmentFor } from "./calendar-collection-copy.js";

describe("calendarUrlSegmentFor", () => {
	test("folds a name into a path segment", () => {
		assert.strictEqual(
			calendarUrlSegmentFor("Harbour Projects"),
			"harbour-projects",
		);
	});

	test("drops accents and punctuation at either end", () => {
		assert.strictEqual(
			calendarUrlSegmentFor("  Café & Crèche!  "),
			"cafe-creche",
		);
	});

	test("stays within the 64 characters the API accepts", () => {
		assert.strictEqual(calendarUrlSegmentFor("a".repeat(80)).length, 64);
	});
});
