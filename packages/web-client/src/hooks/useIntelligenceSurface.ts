import { useAppShellLayout } from "@remit/ui";
import { type RefObject, useCallback, useEffect } from "react";
import { useIntelligenceDrawer } from "@/hooks/useIntelligenceDrawer";
import { useMailContext } from "@/lib/mail-context";

/**
 * Which surface intelligence has for the open thread: the rail from 1280 up,
 * the drawer below that, where the reading pane is mounted and the rail has no
 * room. Every list pane asks this the same way — the brief and Flagged read the
 * rail's own gate as the answer for both tiers and offered a disabled control
 * with nothing behind it between 1024 and 1280 (#817).
 */
export interface IntelligenceSurface extends IntelligenceCommands {
	/** There is a thread to say anything about, so the toolbar's control acts. */
	canToggle: boolean;
	/** What the toolbar reports: the rail above 1280, the drawer below it. */
	isShowing: boolean;
	drawerOpen: boolean;
	closeDrawer: () => void;
	/** Whether this width has room for the rail, so the rail is the surface. */
	railFits: boolean;
	/** Raise the rail if it fits and is down. The DKIM auto-open's way in. */
	openRail: () => void;
}

/**
 * What a mounted intelligence surface answers for. The width gate is the
 * shell's own measurement, so only a component inside `AppShellSlotted` knows
 * which surface this tier has; a pane provider wrapping the shell reaches it
 * through a ref the mounted surface publishes into.
 */
export interface IntelligenceCommands {
	/** The toolbar's control, over whichever surface this width has. */
	toggle: () => void;
	/** The banner's "Why?" — an open, never a close. */
	open: () => void;
}

export const useIntelligenceSurface = (
	openThreadId: string | undefined,
): IntelligenceSurface => {
	const { intelligenceOpen, onToggleIntelligence } = useMailContext();
	const railFits = useAppShellLayout()?.showIntelligencePane ?? false;
	const threadId = openThreadId ?? null;
	const drawer = useIntelligenceDrawer(threadId);
	// The rail wins wherever it fits, so the drawer stays down there even if it
	// was asked for at a narrower width the reader has since grown out of.
	const drawerOpen = !railFits && drawer.isOpen;

	const { open: openDrawer, toggle: toggleDrawer } = drawer;
	const toggle = useCallback(() => {
		if (railFits) {
			onToggleIntelligence();
			return;
		}
		toggleDrawer();
	}, [railFits, onToggleIntelligence, toggleDrawer]);
	const openRail = useCallback(() => {
		if (!railFits || intelligenceOpen) return;
		onToggleIntelligence();
	}, [railFits, intelligenceOpen, onToggleIntelligence]);
	const open = useCallback(() => {
		if (!railFits) {
			openDrawer();
			return;
		}
		openRail();
	}, [railFits, openDrawer, openRail]);

	return {
		canToggle: threadId !== null,
		isShowing: threadId !== null && (railFits ? intelligenceOpen : drawerOpen),
		toggle,
		open,
		drawerOpen,
		closeDrawer: drawer.close,
		railFits,
		openRail,
	};
};

/**
 * Publish the mounted surface for the pane provider's keyboard handlers. Null
 * while nothing is mounted to serve them, so a shortcut fired with no surface
 * reaches nothing rather than writing `#intelligence` at a width that cannot
 * render it (`docs/architecture/url-state.md`, R6).
 */
export const usePublishIntelligenceCommands = (
	ref: RefObject<IntelligenceCommands | null>,
	{ toggle, open }: IntelligenceCommands,
): void => {
	useEffect(() => {
		ref.current = { toggle, open };
		return () => {
			ref.current = null;
		};
	}, [ref, toggle, open]);
};
