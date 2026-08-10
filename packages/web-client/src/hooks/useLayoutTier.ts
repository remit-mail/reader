import {
	DESKTOP_MEDIA_QUERY,
	DESKTOP_MIN_WIDTH,
	useMatchMedia,
} from "@remit/ui";

/**
 * Responsive layout tiers for the mail shell:
 *   - `phone`   (< 768px)        single pane: list → reading swaps in place.
 *   - `tablet`  (768–1023px, or any width on a touch screen held upright)
 *                                single pane, nav rail is drawer-backed.
 *   - `desktop` (>= 1024px, not portrait-on-touch)
 *                                full four-pane shell (nav · list · reading · pane 4).
 *
 * Pane 4 (intelligence) is desktop-only; `useIsDesktop` stays the pane-4 gate.
 */
export type LayoutTier = "phone" | "tablet" | "desktop";

export const TABLET_MIN_WIDTH = 768;

export interface ViewportProfile {
	width: number;
	orientation: "portrait" | "landscape";
	pointer: "coarse" | "fine";
}

/** Pure tier resolution, so the logic is testable without a DOM. */
export const resolveLayoutTier = ({
	width,
	orientation,
	pointer,
}: ViewportProfile): LayoutTier => {
	const heldUpright = orientation === "portrait" && pointer === "coarse";
	if (width >= DESKTOP_MIN_WIDTH && !heldUpright) return "desktop";
	if (width >= TABLET_MIN_WIDTH) return "tablet";
	return "phone";
};

/**
 * Whether the mail shell shows a SINGLE pane (no reading pane) at this tier.
 * AppShellSlotted mounts the reading pane only at desktop, so both phone AND
 * tablet are single-pane: the one pane swaps in place between the list, an
 * open thread, and the compose surface. Compose therefore must mount via the
 * single-pane view at tablet too — keying the pane choice off "phone" alone
 * left tablet with no compose surface ("c" / FAB opened nothing).
 */
export const isSinglePaneTier = (tier: LayoutTier): boolean =>
	tier !== "desktop";

/**
 * Returns the current layout tier. SSR-safe (falls back to `phone` before
 * hydration, matching `useMatchMedia`'s server default).
 */
export const useLayoutTier = (): LayoutTier => {
	const isTabletUp = useMatchMedia(`(min-width: ${TABLET_MIN_WIDTH}px)`);
	const isDesktop = useMatchMedia(DESKTOP_MEDIA_QUERY);
	if (isDesktop) return "desktop";
	if (isTabletUp) return "tablet";
	return "phone";
};
