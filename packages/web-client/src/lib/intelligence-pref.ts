/**
 * Persistence for the intelligence-pane open/closed preference (#782), and the
 * precedence between it and the address (#722).
 *
 * The pane opens with the thread by default; a manual collapse sticks across
 * sessions. Storage failures (private mode / quota) fall back to the default
 * (open) rather than crashing.
 */
import type { PanelFragment } from "@/routing";

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

export interface RailVisibility {
	/** The panels the address names. */
	panels: readonly PanelFragment[];
	prefersOpen: boolean;
	/** The rail is a pane of the desktop shell; narrower tiers have a drawer. */
	isDesktop: boolean;
}

/**
 * Whether the rail is up.
 *
 * An address that names any panel is the only owner of what is open, so a
 * shared link showing the shortcuts sheet is not overwritten by the recipient's
 * own preference. The preference speaks only where the address is silent, and
 * only on the tier that has a rail — it opens with the thread there (#782),
 * while a phone would get a full-screen drawer over a message nobody asked to
 * cover.
 */
export function resolveRailOpen({
	panels,
	prefersOpen,
	isDesktop,
}: RailVisibility): boolean {
	if (panels.length > 0) return panels.includes("intelligence");
	return isDesktop && prefersOpen;
}
