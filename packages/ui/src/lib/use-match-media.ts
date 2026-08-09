import { useEffect, useState } from "react";

/**
 * A media query read from JS and kept in step with the browser's answer. The
 * same conditions the CSS gates on — the desktop query above all — decide
 * behaviour that has no CSS form: which surface a menu opens in, whether a
 * gesture is bound at all.
 */
export const useMatchMedia = (query: string): boolean => {
	const [matches, setMatches] = useState(() => {
		if (typeof window === "undefined" || !window.matchMedia) return false;
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const media = window.matchMedia(query);
		setMatches(media.matches);
		const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
		media.addEventListener("change", handler);
		return () => media.removeEventListener("change", handler);
	}, [query]);

	return matches;
};
