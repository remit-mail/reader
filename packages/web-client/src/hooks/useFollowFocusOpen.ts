/**
 * useFollowFocusOpen — the reading pane follows the keyboard cursor.
 *
 * Moving the cursor with j/k or the arrows loads the row it lands on, the way
 * a desktop mail client does. Enter and a plain click keep opening exactly as
 * they did; only a keyboard move drives this, so a click never opens twice and
 * Tab walking into the list opens nothing.
 *
 * Two properties make it safe to run on every cursor move:
 *
 * - The load waits for the cursor to settle. Key repeat delivers a keydown
 *   every few tens of milliseconds, so holding j down costs one request for the
 *   row it stops on rather than one per row it passes.
 * - Nothing here marks anything read. Read state is set by the dwell in
 *   `useMarkAsRead` — three seconds on the open message — which a fly-past
 *   never reaches and a deliberate open reaches unchanged.
 */
import { useEffect, useRef } from "react";

/**
 * How long the cursor must sit still before its row loads. Comfortably above
 * the ~30ms of a repeating key, so a held key coalesces into a single load,
 * and short enough that a single press reads as immediate.
 */
export const FOLLOW_FOCUS_DELAY_MS = 120;

interface UseFollowFocusOpenOptions {
	/**
	 * The row a keyboard command last moved the cursor onto, and `undefined`
	 * whenever the cursor last moved some other way — a click, a row taking DOM
	 * focus, a thread opening, the list reshuffling under a refetch.
	 */
	keyboardFocusedMessageId: string | undefined;
	/** The row already in the reading pane, so an open row does not reload. */
	openMessageId: string | undefined;
	/**
	 * Whether the cursor may open rows at all. Desktop-only: on the single-pane
	 * tiers the reading pane replaces the list, so following the cursor would
	 * throw the user off the list they are scanning. Also off while rows are
	 * selected, where the cursor is building a selection rather than reading.
	 */
	enabled: boolean;
	/** Opens a row in the reading pane. */
	open: (messageId: string) => void;
	delayMs?: number;
}

export const useFollowFocusOpen = ({
	keyboardFocusedMessageId,
	openMessageId,
	enabled,
	open,
	delayMs = FOLLOW_FOCUS_DELAY_MS,
}: UseFollowFocusOpenOptions): void => {
	// Lists pass an inline opener, so its identity changes every render. Holding
	// it in a ref keeps a re-render from re-arming — and therefore permanently
	// deferring — the pending load.
	const openRef = useRef(open);
	openRef.current = open;

	// The last cursor move made while following was off. Such a move is spent,
	// not deferred: clearing a selection must not load whatever row the cursor
	// happens to be sitting on, only the next move should.
	const declinedRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		const messageId = keyboardFocusedMessageId;
		if (!enabled) {
			declinedRef.current = messageId;
			return;
		}
		if (messageId === undefined) return;
		if (messageId === openMessageId) return;
		if (messageId === declinedRef.current) {
			declinedRef.current = undefined;
			return;
		}
		const timer = setTimeout(() => openRef.current(messageId), delayMs);
		return () => clearTimeout(timer);
	}, [enabled, keyboardFocusedMessageId, openMessageId, delayMs]);
};
