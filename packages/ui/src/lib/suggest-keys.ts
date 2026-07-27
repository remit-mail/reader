/**
 * The keyboard contract for a single-value field with a suggestion list, as pure
 * decisions over the list's state. Kept apart from the component so the rules are
 * testable without a DOM, matching `search-chip-keys.ts`.
 *
 * The list is a shortcut, never a constraint: nothing here can change what the
 * user typed. A key the list has no use for is left alone, so the field, the
 * form, and the surrounding dialog keep their own handling of it.
 *
 * Follows the ARIA combobox pattern's list-with-manual-selection behaviour —
 * arrows move a highlight, an accept key takes the highlighted option, Escape
 * closes the list and leaves the value.
 */

export type SuggestAction =
	/** Move the highlight to `index`. */
	| { type: "move"; index: number }
	/** Take the suggestion at `index` as the field's value. */
	| { type: "accept"; index: number }
	/** Close the list, keeping whatever is typed. */
	| { type: "dismiss" }
	/** The list has no use for this key — the caller keeps its own handling. */
	| { type: "none" };

export interface SuggestKeyState {
	key: string;
	/** Whether the list is on screen. A closed list consumes nothing. */
	open: boolean;
	count: number;
	/** The highlighted option, `-1` when the typed value is what stands. */
	activeIndex: number;
	/**
	 * Keys that take the highlighted suggestion, beyond `Enter` which always
	 * does. A chips field adds `Tab` and `,`; a plain field adds nothing.
	 */
	acceptKeys?: readonly string[];
}

const NONE: SuggestAction = { type: "none" };

export function suggestKeyAction(state: SuggestKeyState): SuggestAction {
	if (!state.open || state.count <= 0) return NONE;

	if (state.key === "ArrowDown") {
		const next = state.activeIndex + 1;
		return { type: "move", index: next >= state.count ? 0 : next };
	}

	if (state.key === "ArrowUp") {
		const previous = state.activeIndex - 1;
		return { type: "move", index: previous < 0 ? state.count - 1 : previous };
	}

	if (state.key === "Escape") return { type: "dismiss" };

	const accepts =
		state.key === "Enter" || (state.acceptKeys ?? []).includes(state.key);
	if (accepts && state.activeIndex >= 0 && state.activeIndex < state.count) {
		return { type: "accept", index: state.activeIndex };
	}

	return NONE;
}
