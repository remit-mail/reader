import type { LayoutTier } from "@/hooks/useLayoutTier";

/**
 * Which surface a list view shows its search on. Two surfaces exist:
 *
 * - the read-only two-engine `SearchResults` panel (literal "Top matches" +
 *   semantic "Related", cross-folder, spam offer), swapped into the list-pane
 *   body on tablet/desktop while searching; and
 * - the view's own body — for the mailbox route a selectable `MessageList` whose
 *   threads filter to the committed search — which hosts multi-select and the
 *   "Select all N matching" escalation (#212).
 *
 * Phone never swaps: it shows the body and keeps the panel in its full-screen
 * takeover instead, so this only decides tablet/desktop.
 *
 * A view whose body renders committed results itself (`bodyRendersCommittedResults`,
 * the mailbox route) keeps the panel only while the query is still being typed —
 * uncommitted, not yet mirrored to the URL — and hands back to the body the moment
 * the query commits, so the committed search is a selectable list. Every other view
 * (the brief, flagged, global search) leaves the flag off and keeps the panel for
 * any query, committed or not.
 */
export const showInlineSearchResults = (input: {
	tier: LayoutTier;
	/** The live field value is non-empty (something is being searched). */
	hasLiveInput: boolean;
	/** The query has settled into the URL (`?q=`), i.e. it is committed. */
	hasCommittedQuery: boolean;
	/** This view's body renders the committed search as a selectable list. */
	bodyRendersCommittedResults: boolean;
}): boolean =>
	input.tier !== "phone" &&
	input.hasLiveInput &&
	!(input.bodyRendersCommittedResults && input.hasCommittedQuery);
