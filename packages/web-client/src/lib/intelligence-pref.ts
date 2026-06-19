/**
 * Persistence for the intelligence-pane open/closed preference (#782).
 *
 * The pane opens with the thread by default; a manual collapse sticks across
 * sessions. Storage failures (private mode / quota) fall back to the default
 * (open) rather than crashing.
 */

export const INTELLIGENCE_PREF_KEY = "remit:intelligence-open";

export function readIntelligencePref(): boolean {
	try {
		return localStorage.getItem(INTELLIGENCE_PREF_KEY) !== "closed";
	} catch {
		return true;
	}
}

export function writeIntelligencePref(open: boolean): void {
	try {
		localStorage.setItem(INTELLIGENCE_PREF_KEY, open ? "open" : "closed");
	} catch {
		// Storage unavailable — the in-memory default stands.
	}
}
