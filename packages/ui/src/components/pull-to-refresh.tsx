import type { ReactElement } from "react";
import ReactPullToRefresh from "react-simple-pull-to-refresh";
import { DESKTOP_MEDIA_QUERY } from "../lib/layout-breakpoints.js";
import { useMatchMedia } from "../lib/use-match-media.js";

export interface PullToRefreshProps {
	children: ReactElement;
	onRefresh: () => Promise<unknown>;
	isRefreshing?: boolean;
}

/**
 * Wraps a scrollable list with a pull-to-refresh gesture on mobile. Below the
 * desktop breakpoint (Tailwind `lg`) a downward pull at the top of the list
 * fires `onRefresh`; at desktop the gesture is inert and children render
 * directly, since there is no touch list to pull.
 *
 * Presentational: the caller owns what refreshing means via `onRefresh` and
 * surfaces in-flight state through `isRefreshing`.
 */
export const PullToRefresh = ({
	children,
	onRefresh,
	isRefreshing,
}: PullToRefreshProps): ReactElement => {
	const isDesktop = useMatchMedia(DESKTOP_MEDIA_QUERY);

	if (isDesktop) {
		return children;
	}

	return (
		<ReactPullToRefresh onRefresh={onRefresh} isPullable={!isRefreshing}>
			{children}
		</ReactPullToRefresh>
	);
};
