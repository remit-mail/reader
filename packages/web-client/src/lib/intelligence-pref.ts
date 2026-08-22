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
	/** The rail reads a conversation, so with none open there is nothing to be up. */
	hasThread: boolean;
	/** The message a transient raise was made for, if one is live. */
	raisedFor: string | null;
	/** The message on screen, which is what a raise is measured against. */
	openMessage: string | null;
}

/**
 * Whether the rail is up.
 *
 * A raise answers first, and only for the message it was made for: a DKIM
 * mismatch or the banner's "Why?" surfaces the rail over a collapse, because
 * the reader is being shown something about what is in front of them — and
 * opening anything else ends it, so one mismatched signature is not the chrome
 * of the whole session (#778). It is measured rather than stored, which is why
 * it never reaches the address or the preference.
 *
 * Otherwise an address that names any panel is the only owner of what is open,
 * so a shared link showing the shortcuts sheet is not overwritten by the
 * recipient's own preference. The preference speaks only where the address is
 * silent, and only with a conversation open on the tier that has a rail — it
 * opens with the thread there (#782), while a phone would get a full-screen
 * drawer over a message nobody asked to cover.
 */
export function resolveRailOpen({
	panels,
	prefersOpen,
	isDesktop,
	hasThread,
	raisedFor,
	openMessage,
}: RailVisibility): boolean {
	if (raisedFor !== null && raisedFor === openMessage) return true;
	if (panels.length > 0) return panels.includes("intelligence");
	return isDesktop && hasThread && prefersOpen;
}
