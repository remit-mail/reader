/**
 * Roving-tabindex math for the message list.
 *
 * A virtualized list of hundreds of rows must expose exactly one tab stop:
 * Tab then moves focus into the list at the keyboard cursor and Shift+Tab moves
 * back out to the side panel, instead of walking every row. Pure so the rule is
 * testable without a DOM.
 */

/**
 * The id of the row that holds the list's tab stop. The keyboard cursor owns it
 * while it points at a loaded row; otherwise the first row does, so an untouched
 * list is still reachable with one Tab.
 */
export function tabStopId(
	orderedIds: string[],
	focusedId: string | undefined,
): string | undefined {
	if (orderedIds.length === 0) return undefined;
	if (focusedId !== undefined && orderedIds.includes(focusedId)) {
		return focusedId;
	}
	return orderedIds[0];
}
