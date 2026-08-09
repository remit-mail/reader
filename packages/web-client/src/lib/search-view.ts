/**
 * Search is a view-level mode, not a persistent global filter (#47).
 *
 * The query belongs to the location it was typed in: the URL's `q` is what a
 * view is searching for, and the nav links already drop `q` when they switch
 * mailbox. The search field, however, is local state in the /mail shell — which
 * outlives every child route — so it kept the old text and went on querying the
 * new mailbox with it (the confusing Mac Mail behaviour). These rules make the
 * URL win on every view change: the field re-seeds from the location it lands
 * on, so switching mailbox clears a stale query while a deep link or a saved
 * search that carries `q` still arrives with the query intact.
 */
import { locationIsOnList } from "./mail-route";

/**
 * The field text after a view transition, or `undefined` when nothing changes
 * (same view — typing, opening a result, mirroring `q` back to the URL).
 */
export function searchInputForView(
	previousViewKey: string,
	viewKey: string,
	urlQuery: string,
): string | undefined {
	if (previousViewKey === viewKey) return undefined;
	return urlQuery;
}

/**
 * The committed query the search APIs run. Typing debounces, but an empty field
 * commits immediately — otherwise a view change fires one more request for the
 * query the user just left behind.
 */
export function committedSearchQuery(
	searchInput: string,
	debouncedSearchInput: string,
): string {
	return searchInput === "" ? "" : debouncedSearchInput;
}

export interface MirrorDecision {
	/** The live field text. */
	searchInput: string;
	/** The debounced query the search APIs are running. */
	committedQuery: string;
	/** What the URL currently says the query is. */
	urlQuery: string;
	/** Where the router says the reader is, which is where a write would land. */
	pathname: string;
	/** The path of the list asking. */
	listPath: string;
}

/**
 * Whether a list may write the committed query into the URL.
 *
 * Only a settled query may: mid-debounce the committed value is the *previous*
 * query, and writing it would overwrite the URL that a deep link or a saved
 * search just arrived with — stripping `q` for as long as the debounce lasts,
 * and taking the search with it. The mirror waits for the field and the
 * committed query to agree, then writes only if the URL says something else.
 *
 * And only the list the reader is actually on may: a list stays mounted, effects
 * and all, until the list they navigated to is ready to paint, by which time the
 * address is already the new one. A write from the outgoing list in that window
 * navigates back to itself, superseding the load in flight and replacing the
 * entry the reader just pushed — they click Inbox and land on the brief.
 */
export function shouldMirrorQuery({
	searchInput,
	committedQuery,
	urlQuery,
	pathname,
	listPath,
}: MirrorDecision): boolean {
	if (!locationIsOnList(pathname, listPath)) return false;
	if (committedQuery !== searchInput) return false;
	return committedQuery !== urlQuery;
}
