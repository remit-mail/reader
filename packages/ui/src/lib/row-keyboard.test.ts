import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSelfRowActivation } from "./row-keyboard.js";

// Two distinct nodes standing in for the row (currentTarget) and a nested
// control such as the trailing star / Clear button (a descendant target).
const row = { id: "row" } as unknown as EventTarget;
const innerButton = { id: "star" } as unknown as EventTarget;

describe("isSelfRowActivation (#1232 keyboard twin-action guard)", () => {
	it("activates on Enter/Space that originate on the row itself", () => {
		for (const key of ["Enter", " "]) {
			assert.equal(
				isSelfRowActivation({ key, target: row, currentTarget: row }),
				true,
			);
		}
	});

	it("ignores Enter/Space bubbled up from a nested control (no twin action)", () => {
		for (const key of ["Enter", " "]) {
			assert.equal(
				isSelfRowActivation({
					key,
					target: innerButton,
					currentTarget: row,
				}),
				false,
			);
		}
	});

	it("ignores other keys even on the row itself", () => {
		for (const key of ["Tab", "a", "ArrowDown", "Escape"]) {
			assert.equal(
				isSelfRowActivation({ key, target: row, currentTarget: row }),
				false,
			);
		}
	});
});
