import { useDrag } from "@use-gesture/react";
import type { FullGestureState } from "@use-gesture/vanilla";
import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";

export type SwipeDirection = "left" | "right";

export const SWIPE_EVENT = "remit:swipe";

export const SWIPE_CONFIG = {
	distance: 60,
	velocity: 0.3,
	duration: 600,
} as const;

export const SWIPE_AXIS_THRESHOLD = 10;

const ZOOMED_SCALE = 1.01;

export const isSwipeDirection = (value: unknown): value is SwipeDirection =>
	value === "left" || value === "right";

export const swipeDirection = (sign: number): SwipeDirection | null => {
	if (sign < 0) return "left";
	if (sign > 0) return "right";
	return null;
};

export const releasedSwipe = (
	state: FullGestureState<"drag">,
): SwipeDirection | null => {
	const { event } = state;
	if ("pointerType" in event && event.pointerType === "mouse") return null;
	if (event.type !== "pointerup") return null;
	return swipeDirection(state.swipe[0]);
};

export const subscribeToZoom = (notify: () => void): (() => void) => {
	const viewport = window.visualViewport;
	viewport?.addEventListener("resize", notify);
	return () => viewport?.removeEventListener("resize", notify);
};

export const isZoomed = (): boolean =>
	(window.visualViewport?.scale ?? 1) > ZOOMED_SCALE;

export const useViewportZoomed = (): boolean =>
	useSyncExternalStore(subscribeToZoom, isZoomed, () => false);

interface UseSwipeNavigationOptions {
	onSwipeLeft?: () => void;
	onSwipeRight?: () => void;
}

interface SwipeNavigation {
	ref: RefObject<HTMLDivElement | null>;
	bind: ReturnType<typeof useDrag>;
	touchAction: "pan-y pinch-zoom" | "auto";
}

export const useSwipeNavigation = ({
	onSwipeLeft,
	onSwipeRight,
}: UseSwipeNavigationOptions): SwipeNavigation => {
	const ref = useRef<HTMLDivElement>(null);
	const zoomed = useViewportZoomed();

	const go = (direction: SwipeDirection | null): void => {
		if (direction === "left") onSwipeLeft?.();
		if (direction === "right") onSwipeRight?.();
	};

	const bind = useDrag((state) => go(releasedSwipe(state)), {
		axis: "x",
		enabled: !zoomed,
		swipe: SWIPE_CONFIG,
		pointer: { keys: false },
	});

	useEffect(() => {
		const element = ref.current;
		if (!element || zoomed) return;
		const onFrameSwipe = (event: Event) => {
			if (!(event instanceof CustomEvent)) return;
			if (isSwipeDirection(event.detail)) go(event.detail);
		};
		element.addEventListener(SWIPE_EVENT, onFrameSwipe);
		return () => element.removeEventListener(SWIPE_EVENT, onFrameSwipe);
	});

	return {
		ref,
		bind,
		touchAction: zoomed ? "auto" : "pan-y pinch-zoom",
	};
};
