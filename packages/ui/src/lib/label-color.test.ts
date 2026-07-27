import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isLabelColorValue,
	labelColorOptions,
	labelDotClass,
} from "./label-color.js";

describe("label-color", () => {
	it("every listed option resolves to a dot class", () => {
		for (const color of labelColorOptions) {
			assert.ok(labelDotClass[color]);
		}
	});

	it("recognizes every named color value", () => {
		for (const color of labelColorOptions) {
			assert.ok(isLabelColorValue(color));
		}
	});

	it("rejects a value outside the named set", () => {
		assert.equal(isLabelColorValue("Chartreuse"), false);
	});
});
