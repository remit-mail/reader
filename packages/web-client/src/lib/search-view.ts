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

/**
 * Whether the committed query may be written back to the URL. Only a settled
 * one may: mid-debounce the committed value is the *previous* query, and
 * writing it would overwrite the URL that a deep link or a saved search just
 * arrived with — stripping `q` for as long as the debounce lasts, and taking
 * the search with it. The mirror waits for the field and the committed query to
 * agree, then writes only if the URL says something else.
 */
export function shouldMirrorQuery(
	searchInput: string,
	committedQuery: string,
	urlQuery: string,
): boolean {
	if (committedQuery !== searchInput) return false;
	return committedQuery !== urlQuery;
}
