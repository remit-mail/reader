/**
 * Selection-mode rules for the message list (#115, refs #92 requirements 9
 * and 10). Pure so "one source of truth, one exit" is testable without a DOM.
 */

import type { StepId } from "@remit/ui";

/** The subset of `@tanstack/history`'s `HistoryAction` a blocker can see. */
export type NavigationAction = "PUSH" | "REPLACE" | "FORWARD" | "BACK" | "GO";

/**
 * Whether a history navigation should exit selection mode instead of leaving
 * the route. Only the back gesture is intercepted, so a navigation the app
 * itself starts (opening a message, switching mailboxes) is never blocked.
 *
 * While the selection wizard is open its own steps own the back gesture, and
 * the selection is what the wizard is acting on — swallowing back there would
 * clear the selection out from under the flow instead of popping a step.
 */
export const shouldExitSelectionOnNavigate = (
	action: NavigationAction,
	hasSelection: boolean,
	wizardStep: StepId | undefined,
): boolean => action === "BACK" && hasSelection && wizardStep === undefined;
