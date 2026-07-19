/**
 * The keyboard contract for the chips-plus-text search expression, as a pure
 * decision over the field's state. Lives apart from the component so the rules
 * are testable without a DOM — the component only maps the result onto React
 * state and callbacks.
 *
 * The contract is the standard chip-input one (Material, CoreUI, Angular
 * Material agree), chosen so a chip is never removed by a single keystroke:
 * the first Backspace at the start of the text selects, the second removes.
 */

export interface ChipKeyState {
	key: string;
	/** Caret sits before all typed text, with nothing selected in the input. */
	caretAtStart: boolean;
	/** The field has typed text (chips aside). */
	hasValue: boolean;
	/** The chip currently marked for deletion, if any. */
	selectedChipId: string | null;
	/** The chip nearest the caret — the one backspace reaches first. */
	lastChipId: string | null;
}

export type ChipKeyAction =
	| { type: "none" }
	/** Mark a chip as the next deletion target. */
	| { type: "selectChip"; id: string }
	/** Remove the marked chip. */
	| { type: "removeChip"; id: string }
	/** Drop the marked chip's selection, leaving it in place. */
	| { type: "deselect" }
	/** Clear the typed text, keeping chips and any open thread. */
	| { type: "clearQuery" }
	| { type: "blur" };

/** Whether the browser's own handling must be suppressed for this action. */
export function preventsDefault(action: ChipKeyAction): boolean {
	return action.type === "selectChip" || action.type === "removeChip";
}

export function resolveChipKey({
	key,
	caretAtStart,
	hasValue,
	selectedChipId,
	lastChipId,
}: ChipKeyState): ChipKeyAction {
	if (key === "Escape") {
		if (selectedChipId) return { type: "deselect" };
		if (hasValue) return { type: "clearQuery" };
		return { type: "blur" };
	}

	if (key === "Backspace" || key === "Delete") {
		if (selectedChipId) return { type: "removeChip", id: selectedChipId };
		// Forward-delete never reaches back over the chips behind the caret.
		if (key === "Delete") return { type: "none" };
		if (!caretAtStart || !lastChipId) return { type: "none" };
		return { type: "selectChip", id: lastChipId };
	}

	if (key === "ArrowLeft") {
		// Already in the chips: let the caret keys fall through rather than
		// walking further back, which would skip over a chip unremarked.
		if (selectedChipId) return { type: "none" };
		if (!caretAtStart || !lastChipId) return { type: "none" };
		return { type: "selectChip", id: lastChipId };
	}

	// Anything else — typing, ArrowRight, Home — puts the user back in the text.
	if (selectedChipId) return { type: "deselect" };
	return { type: "none" };
}
