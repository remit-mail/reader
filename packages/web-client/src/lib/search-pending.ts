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
