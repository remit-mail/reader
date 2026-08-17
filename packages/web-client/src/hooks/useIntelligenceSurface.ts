import { useAppShellLayout } from "@remit/ui";
import { useCallback } from "react";
import { useIntelligenceDrawer } from "@/hooks/useIntelligenceDrawer";
import { useMailContext } from "@/lib/mail-context";

/**
 * Which surface intelligence has for the open thread: the rail from 1280 up,
 * the drawer below that, where the reading pane is mounted and the rail has no
 * room. Every list pane asks this the same way — the brief and Flagged read the
 * rail's own gate as the answer for both tiers and offered a disabled control
 * with nothing behind it between 1024 and 1280 (#817).
 */
export interface IntelligenceSurface {
	/** There is a thread to say anything about, so the toolbar's control acts. */
	canToggle: boolean;
	/** What the toolbar reports: the rail above 1280, the drawer below it. */
	isShowing: boolean;
	/** The toolbar's control, over whichever surface this width has. */
	toggle: () => void;
	/** The banner's "Why?" — an open, never a close. */
	open: () => void;
	drawerOpen: boolean;
	closeDrawer: () => void;
	/** Whether this width has room for the rail, so the rail is the surface. */
	railFits: boolean;
	/** Raise the rail if it fits and is down. The DKIM auto-open's way in. */
	openRail: () => void;
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

	return {
		canToggle: threadId !== null,
		isShowing: threadId !== null && (railFits ? intelligenceOpen : drawerOpen),
		toggle,
		open: railFits ? onToggleIntelligence : openDrawer,
		drawerOpen,
		closeDrawer: drawer.close,
		railFits,
		openRail,
	};
};
