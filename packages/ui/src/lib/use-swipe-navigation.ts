import { useDrag } from "@use-gesture/react";
import type { FullGestureState } from "@use-gesture/vanilla";
import {
	createContext,
	type RefObject,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { SWIPE_DRAG_CONFIG } from "./swipe-config.js";

export type SwipeDirection = "left" | "right";

export const SWIPE_EVENT = "remit:swipe";

export const SwipeSurface = createContext(false);

const ZOOMED_SCALE = 1.01;

export const releasedSwipe = (
	state: FullGestureState<"drag">,
): SwipeDirection | null => {
	const { event } = state;
	if ("pointerType" in event && event.pointerType !== "touch") return null;
	if (event.type !== "pointerup") return null;
	const sign = state.swipe[0];
	if (sign < 0) return "left";
	if (sign > 0) return "right";
	return null;
};

export const subscribeToZoom = (notify: () => void): (() => void) => {
	const viewport = window.visualViewport;
	viewport?.addEventListener("resize", notify);
	return () => viewport?.removeEventListener("resize", notify);
};

export const isZoomed = (): boolean =>
	(window.visualViewport?.scale ?? 1) > ZOOMED_SCALE;

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
	const zoomed = useSyncExternalStore(subscribeToZoom, isZoomed, () => false);

	const go = (direction: SwipeDirection | null): void => {
		if (direction === "left") onSwipeLeft?.();
		if (direction === "right") onSwipeRight?.();
	};

	const bind = useDrag((state) => go(releasedSwipe(state)), {
		...SWIPE_DRAG_CONFIG,
		axis: "x",
		enabled: !zoomed,
	});

	useEffect(() => {
		const element = ref.current;
		if (!element || zoomed) return;
		const onFrameSwipe = (event: Event) => {
			if (!(event instanceof CustomEvent)) return;
			const { detail } = event;
			if (detail === "left" || detail === "right") go(detail);
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
