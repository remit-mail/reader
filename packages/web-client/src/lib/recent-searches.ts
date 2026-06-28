/**
 * Recent search queries for the mobile search takeover, persisted in
 * localStorage. Best-effort: storage failures (private mode, quota) degrade to
 * an empty list rather than crashing the search surface.
 */
const RECENT_SEARCHES_KEY = "remit.recentSearches";
const MAX_RECENT = 5;

export function loadRecentSearches(): string[] {
	try {
		const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((q): q is string => typeof q === "string");
	} catch {
		return [];
	}
}

export function saveRecentSearch(query: string): string[] {
	const trimmed = query.trim();
	if (!trimmed) return loadRecentSearches();
	const next = [
		trimmed,
		...loadRecentSearches().filter((q) => q !== trimmed),
	].slice(0, MAX_RECENT);
	try {
		localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
	} catch {
		return next;
	}
	return next;
}
