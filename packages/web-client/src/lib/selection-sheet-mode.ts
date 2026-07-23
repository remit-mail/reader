import type { SelectionSheetMode } from "@remit/ui";

/**
 * Routes the mobile selection sheet to one of its four content states from the
 * escalation machinery's flags. Pure so the routing — which is what decides
 * whether the sheet shows idle quick actions or the counting / running /
 * escalated status — is testable without the sheet or a DOM.
 *
 * Precedence, highest first:
 * 1. `running` — a chunked delete/move/mark-read is in flight; progress owns
 *    the sheet even over an escalated selection (an escalated run is both).
 * 2. `counting` — a search predicate is still paging to its total.
 * 3. `escalated` — the selection is the search predicate, not a loaded id set.
 * 4. `idle` — a bounded selection with the quick actions and smart-flow rows.
 */
export const resolveSelectionSheetMode = (input: {
	isRunning: boolean;
	isCounting: boolean;
	isEscalated: boolean;
}): SelectionSheetMode => {
	if (input.isRunning) return "running";
	if (input.isCounting) return "counting";
	if (input.isEscalated) return "escalated";
	return "idle";
};

/**
 * The count threshold the peeking teaser rises at — two or more selected, the
 * prototype's threshold. Below it selection mode is still entered (rows show
 * their checkboxes) but no sheet appears, matching today's single-select
 * behaviour of leaving the list chrome alone.
 */
export const SELECTION_SHEET_MIN_COUNT = 2;

/**
 * Whether the mobile sheet should be mounted: two or more rows selected, or any
 * non-idle escalation state (counting, running, escalated) — those own the
 * surface regardless of the loaded count.
 */
export const shouldShowSelectionSheet = (
	count: number,
	mode: SelectionSheetMode,
): boolean => count >= SELECTION_SHEET_MIN_COUNT || mode !== "idle";
