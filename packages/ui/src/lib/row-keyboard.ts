/**
 * A `role="button"` row that holds its own nested controls (a star toggle, a
 * Clear button) can't be a native `<button>` — button-in-button is invalid HTML
 * (#1232). The row wires Enter/Space by hand, but a keydown on a focused inner
 * button bubbles up to the row's `onKeyDown`. Without a guard the row would
 * activate too, firing two actions from one keypress (a native `<button>`
 * ancestor never did this).
 *
 * Act only on keys that originate on the row itself (`target === currentTarget`),
 * so a key bubbled from a descendant control is ignored. This is the row-level
 * twin of the child button's `stopPropagation()` on click.
 */
export function isSelfRowActivation(e: {
	key: string;
	target: EventTarget | null;
	currentTarget: EventTarget | null;
}): boolean {
	if (e.target !== e.currentTarget) return false;
	return e.key === "Enter" || e.key === " ";
}
