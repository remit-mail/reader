import { useEffect, useState } from "react";

/**
 * Subscribes to a CSS media query and returns its current `matches` value.
 * SSR-safe: returns `false` on the server / initial render before hydration.
 *
 * Common breakpoint shortcuts (mobile-first):
 *   useMediaQuery("(min-width: 768px)")  // Tailwind md and up
 *   useMediaQuery("(min-width: 1024px)") // Tailwind lg and up
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
 * True at desktop widths (Tailwind `lg:` and up, ≥1024px). Below this the app
 * renders the single-pane mobile layout: tablet portrait (768px) and phones
 * both fall under here, so they get the stacked list → reading flow with
 * drawer chrome instead of the cramped three-pane desktop grid (#682).
 *
 * The CSS-gated mobile chrome (Drawer, ComposeFab) uses `lg:hidden` to match
 * this boundary — keep them in sync if the breakpoint changes.
 */
export const useIsDesktop = (): boolean => useMediaQuery("(min-width: 1024px)");
