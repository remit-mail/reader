// Reading-pane suppression guard for the mail search bar (#539, #623).
//
// `searchInput` is the live (pre-debounce) value the user is typing;
// `searchQuery` is the debounced (committed) value sent to the API. A debounce
// is in flight whenever the two differ — during that window the reading pane is
// kept closed so it clears the instant a new search starts (#539). Once the
// query settles, a selected result is honored so search results can be opened
// (#623).
export const isSearchPending = (
	searchInput: string,
	searchQuery: string,
): boolean => searchInput !== searchQuery;

// Resolve the thread to show in the reading pane. Returns `undefined` while a
// search debounce is pending or when nothing is selected; otherwise looks the
// selected message up in the loaded thread list.
export const resolveSelectedThread = <T extends { messageId: string }>(
	threads: T[],
	selectedMessageId: string | undefined,
	pending: boolean,
): T | undefined => {
	if (pending || !selectedMessageId) return undefined;
	return threads.find((t) => t.messageId === selectedMessageId);
};

/**
 * The thread the reading pane shows, once the list is a server-side query
 * (#306).
 *
 * The list used to hold every loaded row and filter a copy, so an open thread
 * could always be found again in the unfiltered set. A filtered list is now the
 * server's answer to one predicate, and a chip the open message does not match
 * pages it out — so what the user opened is kept as a snapshot and answers for
 * itself until they open something else. That is a derivation over the user's
 * own selection, which stays on this side of the boundary.
 *
 * The snapshot is ignored while a search debounce is pending, so the pane still
 * clears the instant a new search starts (#539).
 */
export const resolveOpenThread = <T extends { messageId: string }>(
	listed: T | undefined,
	opened: T | undefined,
	selectedMessageId: string | undefined,
	pending: boolean,
): T | undefined => {
	if (listed) return listed;
	if (pending || !selectedMessageId) return undefined;
	return opened?.messageId === selectedMessageId ? opened : undefined;
};
