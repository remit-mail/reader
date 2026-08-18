import { useCallback, useState } from "react";

/**
 * The intelligence drawer's own state, scoped to the thread it was opened for.
 *
 * The drawer is modal, so it opens only when it is asked for. `intelligenceOpen`
 * is the rail's persisted preference and the DKIM auto-open sets it on every
 * tier, so driving the drawer from it throws a scrim over a message the moment
 * one is selected — and the reader's next tap lands on that scrim instead of the
 * control they aimed at, Back to messages included. Naming the thread is also
 * what closes it again when they move on: a bare flag would still be set when
 * they came back.
 */
export interface IntelligenceDrawer {
	/** Up only while the thread it was opened for is the one on screen. */
	isOpen: boolean;
	/** The banner's "Why?" — always an open, never a close. */
	open: () => void;
	close: () => void;
	/** The toolbar's control. */
	toggle: () => void;
}

export function useIntelligenceDrawer(
	openThreadId: string | null,
): IntelligenceDrawer {
	const [drawerThreadId, setDrawerThreadId] = useState<string | null>(null);
	// Derived rather than stored: moving to another thread closes it with no
	// effect to run. Closing it from an effect would paint one frame of an open
	// drawer over the newly opened thread first.
	const isOpen = openThreadId !== null && drawerThreadId === openThreadId;

	const close = useCallback(() => setDrawerThreadId(null), []);
	const open = useCallback(
		() => setDrawerThreadId(openThreadId),
		[openThreadId],
	);
	const toggle = useCallback(
		() => setDrawerThreadId(isOpen ? null : openThreadId),
		[isOpen, openThreadId],
	);

	return { isOpen, open, close, toggle };
}
