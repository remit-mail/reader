import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type ChipKeyState,
	preventsDefault,
	resolveChipKey,
} from "./search-chip-keys.js";

const state = (overrides: Partial<ChipKeyState> = {}): ChipKeyState => ({
	key: "a",
	caretAtStart: true,
	hasValue: false,
	selectedChipId: null,
	lastChipId: "in:spam",
	...overrides,
});

describe("Backspace removes a chip in two steps, never one", () => {
	it("selects the nearest chip on the first press at the start of the text", () => {
		assert.deepEqual(resolveChipKey(state({ key: "Backspace" })), {
			type: "selectChip",
			id: "in:spam",
		});
	});

	it("removes the selected chip on the second press", () => {
		assert.deepEqual(
			resolveChipKey(state({ key: "Backspace", selectedChipId: "in:spam" })),
			{ type: "removeChip", id: "in:spam" },
		);
	});

	it("edits the text as usual while the caret is not at the start", () => {
		assert.deepEqual(
			resolveChipKey(
				state({ key: "Backspace", caretAtStart: false, hasValue: true }),
			),
			{ type: "none" },
		);
	});

	it("does nothing at the start of the text with no chips behind the caret", () => {
		assert.deepEqual(
			resolveChipKey(state({ key: "Backspace", lastChipId: null })),
			{ type: "none" },
		);
	});

	it("suppresses the browser's own handling only when acting on a chip", () => {
		assert.equal(
			preventsDefault(resolveChipKey(state({ key: "Backspace" }))),
			true,
		);
		assert.equal(
			preventsDefault(
				resolveChipKey(state({ key: "Backspace", caretAtStart: false })),
			),
			false,
		);
	});
});

describe("Delete does not reach backwards over the chips", () => {
	it("is inert at the start of the text with nothing selected", () => {
		assert.deepEqual(resolveChipKey(state({ key: "Delete" })), {
			type: "none",
		});
	});

	it("removes an already-selected chip", () => {
		assert.deepEqual(
			resolveChipKey(state({ key: "Delete", selectedChipId: "in:spam" })),
			{ type: "removeChip", id: "in:spam" },
		);
	});
});

describe("The caret keys walk between the text and the chips", () => {
	it("selects the nearest chip on ArrowLeft at the start of the text", () => {
		assert.deepEqual(resolveChipKey(state({ key: "ArrowLeft" })), {
			type: "selectChip",
			id: "in:spam",
		});
	});

	it("does not walk further back once a chip is selected", () => {
		assert.deepEqual(
			resolveChipKey(state({ key: "ArrowLeft", selectedChipId: "in:spam" })),
			{ type: "none" },
		);
	});

	it("returns to the text on ArrowRight", () => {
		assert.deepEqual(
			resolveChipKey(state({ key: "ArrowRight", selectedChipId: "in:spam" })),
			{ type: "deselect" },
		);
	});

	it("returns to the text as soon as the user types", () => {
		assert.deepEqual(
			resolveChipKey(state({ key: "x", selectedChipId: "in:spam" })),
			{ type: "deselect" },
		);
	});
});

describe("Escape unwinds one layer at a time", () => {
	it("deselects a selected chip before touching the query", () => {
		assert.deepEqual(
			resolveChipKey(
				state({ key: "Escape", selectedChipId: "in:spam", hasValue: true }),
			),
			{ type: "deselect" },
		);
	});

	it("clears the typed text when nothing is selected", () => {
		assert.deepEqual(resolveChipKey(state({ key: "Escape", hasValue: true })), {
			type: "clearQuery",
		});
	});

	it("blurs the field once the text is already empty", () => {
		assert.deepEqual(resolveChipKey(state({ key: "Escape" })), {
			type: "blur",
		});
	});
});
