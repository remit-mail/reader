import { DESKTOP_MEDIA_QUERY } from "@remit/ui";
import { useEffect, useState } from "react";

/**
 * Subscribes to a CSS media query and returns its current `matches` value.
 * SSR-safe: returns `false` on the server / initial render before hydration.
 *
 * Layout breakpoints are exported by `@remit/ui` alongside the Tailwind
 * variants they mirror — pass those, not a hand-written width.
 */
export const useMediaQuery = (query: string): boolean => {
	const [matches, setMatches] = useState(() => {
		if (typeof window === "undefined" || !window.matchMedia) return false;
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const mql = window.matchMedia(query);
		const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
		// Sync state on mount in case the SSR/initial render disagreed.
		setMatches(mql.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, [query]);

	return matches;
};

/**
 * True at desktop (Tailwind `lg:` and up): at least 1024px wide and not a
 * touch screen held upright. Everything else renders the single-pane mobile
 * layout — phones, narrow tablets, and a large tablet in portrait, which is
 * 1024px wide but has no room for the three-pane desktop grid (#682).
 *
 * The CSS-gated mobile chrome (Drawer, ComposeFab) uses `lg:hidden`, and the
 * `lg` variant is redefined in `@remit/ui`'s token sheet with the same
 * condition — change `DESKTOP_MEDIA_QUERY` and both move together.
 */
export const useIsDesktop = (): boolean => useMediaQuery(DESKTOP_MEDIA_QUERY);
