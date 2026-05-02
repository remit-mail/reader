// Pre-query normalizer for the mail search bar. We keep the user's typed
// casing visible in the input and the "results for X" header, but the value
// sent to the backend (and used as the React Query cache key) is folded to
// lowercase so equivalent searches collide on the same cache entry and the
// server-side comparison is case-insensitive.
//
// `toLocaleLowerCase` (no locale arg) uses the host locale, which handles
// Unicode edge cases that ASCII `toLowerCase` mishandles — most notably the
// Turkish dotless I (`I` → `ı` / `İ` → `i`).
export const normalizeSearchQuery = (query: string): string =>
	query.trim().toLocaleLowerCase();
