import { useMediaQuery } from "./useMediaQuery";

/**
 * Responsive layout tiers for the mail shell:
 *   - `phone`   (< 768px)        single pane: list → reading swaps in place.
 *   - `tablet`  (768–1023px)     two panes: list + reading, nav rail is drawer-backed.
 *   - `desktop` (>= 1024px)      full four-pane shell (nav · list · reading · pane 4).
 *
 * Pane 4 (intelligence) is desktop-only; `useIsDesktop` stays the pane-4 gate.
 */
export type LayoutTier = "phone" | "tablet" | "desktop";

export const TABLET_MIN_WIDTH = 768;
export const DESKTOP_MIN_WIDTH = 1024;

/** Pure breakpoint resolution, so the tier logic is testable without a DOM. */
export const resolveLayoutTier = (width: number): LayoutTier => {
	if (width >= DESKTOP_MIN_WIDTH) return "desktop";
	if (width >= TABLET_MIN_WIDTH) return "tablet";
	return "phone";
};

/**
 * Returns the current layout tier. SSR-safe (falls back to `phone` before
 * hydration, matching `useMediaQuery`'s server default).
 */
export const useLayoutTier = (): LayoutTier => {
	const isTabletUp = useMediaQuery(`(min-width: ${TABLET_MIN_WIDTH}px)`);
	const isDesktop = useMediaQuery(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
	if (isDesktop) return "desktop";
	if (isTabletUp) return "tablet";
	return "phone";
};
