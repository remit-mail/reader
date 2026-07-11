/**
 * Saved searches for the mail search bar, persisted in localStorage (#428
 * follow-up, local-only MVP — see doc/design/flows/06-search.md; no backend
 * preference storage yet). Mirrors `recent-searches.ts`: a query already
 * carries its filter chips (`parseSearchTokens` re-derives them), so saving
 * the raw query text is enough to reproduce the full search. Best-effort:
 * storage failures (private mode, quota) degrade to an empty list rather than
 * crashing the search surface.
 */
const SAVED_SEARCHES_KEY = "remit.savedSearches";
const MAX_SAVED = 25;

export function loadSavedSearches(): string[] {
	try {
		const raw = localStorage.getItem(SAVED_SEARCHES_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((q): q is string => typeof q === "string");
	} catch {
		return [];
	}
}

export function saveSearch(query: string): string[] {
	const trimmed = query.trim();
	if (!trimmed) return loadSavedSearches();
	const next = [
		trimmed,
		...loadSavedSearches().filter((q) => q !== trimmed),
	].slice(0, MAX_SAVED);
	try {
		localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
	} catch {
		return next;
	}
	return next;
}

export function removeSavedSearch(query: string): string[] {
	const next = loadSavedSearches().filter((q) => q !== query);
	try {
		localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
	} catch {
		return next;
	}
	return next;
}

export function isSearchSaved(query: string): boolean {
	return loadSavedSearches().includes(query.trim());
}
