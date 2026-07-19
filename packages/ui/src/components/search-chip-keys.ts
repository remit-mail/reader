/**
 * The keyboard contract for the chips-plus-text search expression, as pure
 * decisions over the field's state. Kept apart from the component so the rules
 * are testable without a DOM — the component only maps a result onto focus and
 * callbacks.
 *
 * Focus is roving: the whole field is one Tab stop, and focus sits either on
 * the text input or on exactly one chip. Which one it sits on is what makes a
 * keystroke mean "edit the query" or "act on a chip", so the two surfaces get
 * one resolver each.
 *
 * Grounded in Material Design 3's chip accessibility guidance and Angular
 * Material's `mat-chip-grid`, the closest documented chips-inside-a-field
 * precedent. There is no W3C ARIA pattern for chips, so this is an adaptation
 * rather than an implementation of a standard — it is settled by screen-reader
 * testing, not by role names alone.
 */

/** Where focus should land. `null` means the text input. */
export type ChipFocusTarget = number | null;

export type ChipInputAction =
	/** Move focus off the text and onto a chip. */
	| { type: "focusChip"; index: number }
	/** Clear the typed text, leaving the chips and any open thread alone. */
	| { type: "clearQuery" }
	| { type: "blur" }
	| { type: "none" };

export type ChipAction =
	| { type: "removeChip"; index: number }
	| { type: "focusChip"; index: number }
	/** Return focus to the text input. */
	| { type: "focusInput" }
	/** Open the chip's own editor, where the host provides one. */
	| { type: "activateChip"; index: number }
	| { type: "none" };

export interface ChipInputKeyState {
	key: string;
	shiftKey?: boolean;
	/**
	 * The keystroke came from the keyboard's auto-repeat, not a fresh press.
	 * Holding Backspace to clear the text must stop at the chips instead of
	 * running on into them, which would collapse the two-press rule into one
	 * held key.
	 */
	repeat?: boolean;
	/** Caret sits before all typed text, with nothing selected in the input. */
	caretAtStart: boolean;
	/** The field has typed text. */
	hasValue: boolean;
	chipCount: number;
}

export interface ChipKeyState {
	key: string;
	/** See `ChipInputKeyState.repeat`. */
	repeat?: boolean;
	/** Index of the chip that currently holds focus. */
	index: number;
	chipCount: number;
}

/**
 * Keystrokes while the caret is in the text.
 *
 * Backspace at the very start of the text moves focus onto the preceding chip
 * rather than removing it — the press that removes it is the next one, handled
 * by `resolveChipKey`. Two presses, so a compound term is never destroyed by a
 * stray keystroke.
 */
export function resolveChipInputKey({
	key,
	shiftKey = false,
	repeat = false,
	caretAtStart,
	hasValue,
	chipCount,
}: ChipInputKeyState): ChipInputAction {
	const lastChip = chipCount - 1;

	if (key === "Escape") {
		if (hasValue) return { type: "clearQuery" };
		return { type: "blur" };
	}

	// Shift+Tab walks back into the chips instead of leaving the field, so the
	// chips are reachable without a pointer.
	if (key === "Tab" && shiftKey) {
		if (chipCount === 0) return { type: "none" };
		return { type: "focusChip", index: lastChip };
	}

	if (key === "Backspace" || key === "ArrowLeft") {
		if (!caretAtStart || chipCount === 0) return { type: "none" };
		// A held key that has just eaten the last character stops here: crossing
		// into the chips has to be a deliberate press.
		if (repeat) return { type: "none" };
		return { type: "focusChip", index: lastChip };
	}

	return { type: "none" };
}

/** Keystrokes while a chip holds focus. */
export function resolveChipKey({
	key,
	repeat = false,
	index,
	chipCount,
}: ChipKeyState): ChipAction {
	if (key === "Backspace" || key === "Delete") {
		// One press, one chip. Holding the key must not walk the whole strip.
		if (repeat) return { type: "none" };
		return { type: "removeChip", index };
	}

	if (key === "ArrowLeft") {
		if (index === 0) return { type: "none" };
		return { type: "focusChip", index: index - 1 };
	}

	if (key === "ArrowRight") {
		// Past the last chip is the text, caret at the start.
		if (index >= chipCount - 1) return { type: "focusInput" };
		return { type: "focusChip", index: index + 1 };
	}

	if (key === "Enter" || key === " ") {
		return { type: "activateChip", index };
	}

	if (key === "Escape") {
		return { type: "focusInput" };
	}

	return { type: "none" };
}

/**
 * Where focus lands after the chip at `removedIndex` is removed: the chip that
 * takes its place, else the one before it, else the text input. Never nowhere —
 * a removal that drops focus to the document body strands keyboard users.
 */
export function focusAfterRemoval(
	removedIndex: number,
	countBeforeRemoval: number,
): ChipFocusTarget {
	const remaining = countBeforeRemoval - 1;
	if (remaining <= 0) return null;
	if (removedIndex < remaining) return removedIndex;
	return remaining - 1;
}
