import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type ChipInputKeyState,
	type ChipKeyState,
	focusAfterRemoval,
	resolveChipInputKey,
	resolveChipKey,
} from "./search-chip-keys.js";

const inText = (
	overrides: Partial<ChipInputKeyState> = {},
): ChipInputKeyState => ({
	key: "a",
	caretAtStart: true,
	hasValue: false,
	chipCount: 1,
	...overrides,
});

const onChip = (overrides: Partial<ChipKeyState> = {}): ChipKeyState => ({
	key: "Backspace",
	index: 0,
	chipCount: 1,
	...overrides,
});

describe("Removing a chip by keyboard takes two presses, never one", () => {
	it("first Backspace at the start of the text moves focus onto the last chip", () => {
		assert.deepEqual(resolveChipInputKey(inText({ key: "Backspace" })), {
			type: "focusChip",
			index: 0,
		});
	});

	it("second Backspace — now on the chip — removes it", () => {
		assert.deepEqual(resolveChipKey(onChip({ key: "Backspace" })), {
			type: "removeChip",
			index: 0,
		});
	});

	it("Delete on a focused chip removes it too", () => {
		assert.deepEqual(resolveChipKey(onChip({ key: "Delete" })), {
			type: "removeChip",
			index: 0,
		});
	});

	it("leaves ordinary text editing alone when the caret is not at the start", () => {
		assert.deepEqual(
			resolveChipInputKey(
				inText({ key: "Backspace", caretAtStart: false, hasValue: true }),
			),
			{ type: "none" },
		);
	});

	it("does nothing at the start of the text when there are no chips", () => {
		assert.deepEqual(
			resolveChipInputKey(inText({ key: "Backspace", chipCount: 0 })),
			{ type: "none" },
		);
	});
});

describe("Focus walks between the text and the chips", () => {
	it("ArrowLeft at the start of the text steps onto the last chip", () => {
		assert.deepEqual(
			resolveChipInputKey(inText({ key: "ArrowLeft", chipCount: 3 })),
			{ type: "focusChip", index: 2 },
		);
	});

	it("Shift+Tab steps back into the chips rather than leaving the field", () => {
		assert.deepEqual(
			resolveChipInputKey(
				inText({
					key: "Tab",
					shiftKey: true,
					chipCount: 3,
					caretAtStart: false,
				}),
			),
			{ type: "focusChip", index: 2 },
		);
	});

	it("Shift+Tab leaves the field when there are no chips to step into", () => {
		assert.deepEqual(
			resolveChipInputKey(inText({ key: "Tab", shiftKey: true, chipCount: 0 })),
			{ type: "none" },
		);
	});

	it("ArrowLeft walks to the previous chip", () => {
		assert.deepEqual(
			resolveChipKey(onChip({ key: "ArrowLeft", index: 2, chipCount: 3 })),
			{ type: "focusChip", index: 1 },
		);
	});

	it("ArrowLeft stops at the first chip", () => {
		assert.deepEqual(
			resolveChipKey(onChip({ key: "ArrowLeft", index: 0, chipCount: 3 })),
			{ type: "none" },
		);
	});

	it("ArrowRight walks to the next chip", () => {
		assert.deepEqual(
			resolveChipKey(onChip({ key: "ArrowRight", index: 0, chipCount: 3 })),
			{ type: "focusChip", index: 1 },
		);
	});

	it("ArrowRight past the last chip returns to the text", () => {
		assert.deepEqual(
			resolveChipKey(onChip({ key: "ArrowRight", index: 2, chipCount: 3 })),
			{ type: "focusInput" },
		);
	});

	it("Escape on a chip returns to the text", () => {
		assert.deepEqual(resolveChipKey(onChip({ key: "Escape" })), {
			type: "focusInput",
		});
	});

	it("Enter and Space activate the focused chip", () => {
		for (const key of ["Enter", " "]) {
			assert.deepEqual(
				resolveChipKey(onChip({ key, index: 1, chipCount: 3 })),
				{
					type: "activateChip",
					index: 1,
				},
			);
		}
	});
});

describe("Escape in the text unwinds the query before the field", () => {
	it("clears the typed text first", () => {
		assert.deepEqual(
			resolveChipInputKey(inText({ key: "Escape", hasValue: true })),
			{ type: "clearQuery" },
		);
	});

	it("blurs once the text is already empty", () => {
		assert.deepEqual(resolveChipInputKey(inText({ key: "Escape" })), {
			type: "blur",
		});
	});
});

describe("Focus after a removal never falls off the field", () => {
	it("lands on the chip that took the removed one's place", () => {
		assert.equal(focusAfterRemoval(0, 3), 0);
	});

	it("falls back to the preceding chip when the last one goes", () => {
		assert.equal(focusAfterRemoval(2, 3), 1);
	});

	it("returns to the text input once the last chip is gone", () => {
		assert.equal(focusAfterRemoval(0, 1), null);
	});
});
