import { useCallback, useRef } from "react";

export type SwipeDirection = "left" | "right";

interface UseSwipeNavigationOptions {
	/**
	 * Swipe left (content advances, finger moves right→left): go to the NEXT
	 * item — the platform convention for paging through content (photos, mail).
	 */
	onSwipeLeft?: () => void;
	/** Swipe right: go to the PREVIOUS item. */
	onSwipeRight?: () => void;
	/** Minimum horizontal travel (px) before a swipe registers. */
	thresholdPx?: number;
}

interface SwipeHandlers {
	onPointerDown: (e: React.PointerEvent) => void;
	onPointerMove: (e: React.PointerEvent) => void;
	onPointerUp: (e: React.PointerEvent) => void;
	onPointerCancel: () => void;
}

const DEFAULT_THRESHOLD = 60;
/**
 * A gesture only counts as a horizontal swipe when its horizontal travel
 * dominates the vertical. Anything more vertical than this is the user
 * scrolling the message body, and we leave it alone.
 */
const HORIZONTAL_DOMINANCE = 1.5;

export interface SwipeResolution {
	direction: SwipeDirection | null;
}

/**
 * Pure swipe classifier. Returns the swipe direction, or `null` when the
 * gesture is too short or too vertical to count as a horizontal swipe (so it
 * never hijacks vertical scrolling).
 */
export const resolveSwipe = (
	dx: number,
	dy: number,
	thresholdPx: number,
): SwipeResolution => {
	const absX = Math.abs(dx);
	const absY = Math.abs(dy);
	if (absX < thresholdPx) return { direction: null };
	if (absX < absY * HORIZONTAL_DOMINANCE) return { direction: null };
	return { direction: dx < 0 ? "left" : "right" };
};

/**
 * Detects horizontal swipe gestures from pointer events and routes them to
 * next/previous callbacks. Only reacts to touch/pen pointers so mouse drags on
 * desktop never trigger navigation. Vertical scroll is left untouched: a
 * gesture must travel mostly sideways to register.
 */
export const useSwipeNavigation = ({
	onSwipeLeft,
	onSwipeRight,
	thresholdPx = DEFAULT_THRESHOLD,
}: UseSwipeNavigationOptions): { handlers: SwipeHandlers } => {
	const startRef = useRef<{ x: number; y: number } | null>(null);

	const onPointerDown = useCallback((e: React.PointerEvent) => {
		if (e.pointerType === "mouse") {
			startRef.current = null;
			return;
		}
		startRef.current = { x: e.clientX, y: e.clientY };
	}, []);

	const onPointerMove = useCallback(() => {}, []);

	const onPointerUp = useCallback(
		(e: React.PointerEvent) => {
			const start = startRef.current;
			startRef.current = null;
			if (!start) return;
			const { direction } = resolveSwipe(
				e.clientX - start.x,
				e.clientY - start.y,
				thresholdPx,
			);
			if (direction === "left") onSwipeLeft?.();
			if (direction === "right") onSwipeRight?.();
		},
		[onSwipeLeft, onSwipeRight, thresholdPx],
	);

	const onPointerCancel = useCallback(() => {
		startRef.current = null;
	}, []);

	return {
		handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
	};
};
