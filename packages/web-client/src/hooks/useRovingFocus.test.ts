import assert from "node:assert";
import { describe, test } from "node:test";
import { rovingFocusInternals } from "./useRovingFocus.ts";

const { findNextSelectable, findFirstSelectable, findLastSelectable } =
	rovingFocusInternals;

const allEnabled = () => false;
const disable = (...indices: readonly number[]) => {
	const set = new Set(indices);
	return (i: number) => set.has(i);
};

describe("useRovingFocus state machine", () => {
	describe("findFirstSelectable", () => {
		test("returns 0 when all options are enabled", () => {
			assert.strictEqual(findFirstSelectable(5, allEnabled), 0);
		});

		test("skips leading disabled options", () => {
			assert.strictEqual(findFirstSelectable(5, disable(0, 1)), 2);
		});

		test("returns -1 when count is 0", () => {
			assert.strictEqual(findFirstSelectable(0, allEnabled), -1);
		});

		test("returns -1 when every option is disabled", () => {
			assert.strictEqual(findFirstSelectable(3, disable(0, 1, 2)), -1);
		});
	});

	describe("findLastSelectable", () => {
		test("returns count - 1 when all enabled", () => {
			assert.strictEqual(findLastSelectable(5, allEnabled), 4);
		});

		test("skips trailing disabled options", () => {
			assert.strictEqual(findLastSelectable(5, disable(3, 4)), 2);
		});

		test("returns -1 when every option is disabled", () => {
			assert.strictEqual(findLastSelectable(3, disable(0, 1, 2)), -1);
		});
	});

	describe("findNextSelectable forward", () => {
		test("steps forward by 1", () => {
			assert.strictEqual(findNextSelectable(5, 1, 1, allEnabled), 2);
		});

		test("wraps from last to first", () => {
			assert.strictEqual(findNextSelectable(5, 4, 1, allEnabled), 0);
		});

		test("skips a disabled option", () => {
			assert.strictEqual(findNextSelectable(5, 0, 1, disable(1)), 2);
		});

		test("wraps over disabled tail", () => {
			assert.strictEqual(findNextSelectable(5, 2, 1, disable(3, 4)), 0);
		});

		test("returns -1 when no option is selectable", () => {
			assert.strictEqual(findNextSelectable(3, 0, 1, disable(0, 1, 2)), -1);
		});

		test("starts from 0 when from is -1", () => {
			assert.strictEqual(findNextSelectable(5, -1, 1, allEnabled), 0);
		});
	});

	describe("findNextSelectable backward", () => {
		test("steps backward by 1", () => {
			assert.strictEqual(findNextSelectable(5, 2, -1, allEnabled), 1);
		});

		test("wraps from first to last", () => {
			assert.strictEqual(findNextSelectable(5, 0, -1, allEnabled), 4);
		});

		test("skips a disabled option going backward", () => {
			assert.strictEqual(findNextSelectable(5, 3, -1, disable(2)), 1);
		});

		test("wraps over disabled head", () => {
			assert.strictEqual(findNextSelectable(5, 2, -1, disable(0, 1)), 4);
		});
	});

	describe("composition: simulating arrow-key sequences", () => {
		test("ArrowDown across a list with one disabled option", () => {
			const isDisabled = disable(2);
			let index = findFirstSelectable(5, isDisabled);
			assert.strictEqual(index, 0);

			index = findNextSelectable(5, index, 1, isDisabled);
			assert.strictEqual(index, 1);

			index = findNextSelectable(5, index, 1, isDisabled);
			assert.strictEqual(index, 3, "should skip disabled index 2");

			index = findNextSelectable(5, index, 1, isDisabled);
			assert.strictEqual(index, 4);

			index = findNextSelectable(5, index, 1, isDisabled);
			assert.strictEqual(index, 0, "should wrap to first selectable");
		});

		test("ArrowUp from start wraps past disabled tail", () => {
			const isDisabled = disable(4);
			const index = findNextSelectable(5, 0, -1, isDisabled);
			assert.strictEqual(index, 3);
		});

		test("Home/End respect disabled options at the edges", () => {
			const isDisabled = disable(0, 4);
			assert.strictEqual(findFirstSelectable(5, isDisabled), 1);
			assert.strictEqual(findLastSelectable(5, isDisabled), 3);
		});
	});
});
