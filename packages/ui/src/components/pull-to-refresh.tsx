import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import ReactPullToRefresh from "react-simple-pull-to-refresh";

export interface PullToRefreshProps {
	children: ReactElement;
	onRefresh: () => Promise<unknown>;
	isRefreshing?: boolean;
}

const useMatchMedia = (query: string): boolean => {
	const [matches, setMatches] = useState(() => {
		if (typeof window === "undefined" || !window.matchMedia) return false;
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const mql = window.matchMedia(query);
		setMatches(mql.matches);
		const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, [query]);

	return matches;
};

/**
 * Wraps a scrollable list with a pull-to-refresh gesture on mobile. Below the
 * desktop breakpoint (Tailwind `lg`, 1024px) a downward pull at the top of the
 * list fires `onRefresh`; at desktop widths the gesture is inert and children
 * render directly, since there is no touch list to pull.
 *
 * Presentational: the caller owns what refreshing means via `onRefresh` and
 * surfaces in-flight state through `isRefreshing`.
 */
export const PullToRefresh = ({
	children,
	onRefresh,
	isRefreshing,
}: PullToRefreshProps): ReactElement => {
	const isDesktop = useMatchMedia("(min-width: 1024px)");

	if (isDesktop) {
		return children;
	}

	return (
		<ReactPullToRefresh onRefresh={onRefresh} isPullable={!isRefreshing}>
			{children}
		</ReactPullToRefresh>
	);
};
