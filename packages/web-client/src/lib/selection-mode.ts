/**
 * Selection-mode rules for the message list (#115, refs #92 requirements 9
 * and 10). Pure so "one source of truth, one exit" is testable without a DOM.
 */

/** The subset of `@tanstack/history`'s `HistoryAction` a blocker can see. */
export type NavigationAction = "PUSH" | "REPLACE" | "FORWARD" | "BACK" | "GO";

/**
 * Whether the list is in multi-select mode: a function of the selection count,
 * never a stored flag, so the two can never disagree. Multi-select is the
 * touch affordance (long press, always-visible checkboxes, the selection top
 * bar); on desktop a selection drives the desktop toolbar instead and rows
 * keep their ordinary hover behaviour.
 */
export const deriveIsMultiSelectMode = (
	selectedCount: number,
	isDesktop: boolean,
): boolean => !isDesktop && selectedCount > 0;

/**
 * Whether a history navigation should exit selection mode instead of leaving
 * the route. Only the back gesture is intercepted, so a navigation the app
 * itself starts (opening a message, switching mailboxes) is never blocked.
 */
export const shouldExitSelectionOnNavigate = (
	action: NavigationAction,
	hasSelection: boolean,
): boolean => action === "BACK" && hasSelection;
