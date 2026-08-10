import type { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { AppShellSkeleton } from "./components/layout/AppShellSkeleton";
import { recordRoute } from "./lib/route-breadcrumbs";
import type { Telemetry } from "./lib/telemetry";
import { routeTree } from "./routeTree.gen";

export interface RouterContext {
	queryClient: QueryClient;
}

export const createAppRouter = (
	queryClient: QueryClient,
	telemetry: Telemetry,
) => {
	const router = createRouter({
		routeTree,
		context: { queryClient },
		defaultPreload: "intent",
		// A route arrives with its own code, and each mail list carries a whole pane
		// in it. Without a pending state the router keeps the previous route on
		// screen for that fetch and first mount, under the new address — so the list
		// the reader has left stays interactive: a click routes through its handlers
		// and takes them back to it, and the keyboard drives its cursor. Preloading
		// on intent does not close that: it fires on hover and focus, so it only
		// moves the window's start, and it never applies to the navigations the
		// keyboard shortcuts make.
		//
		// 200ms is above a preloaded transition, which lands in tens of milliseconds
		// and so paints no skeleton at all, and below the point where a stale list
		// invites a click. Once shown it stays 300ms, so a transition that settles
		// just after the threshold does not strobe.
		defaultPendingComponent: AppShellSkeleton,
		defaultPendingMs: 200,
		defaultPendingMinMs: 300,
	});

	router.subscribe("onResolved", (event) => {
		telemetry.recordPageView(event.toLocation.pathname);
		// A metadata-only navigation trail for bug reports; pathname only, never
		// the query string (route-breadcrumbs.ts enforces the redaction).
		recordRoute(event.toLocation.pathname);
	});

	return router;
};

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof createAppRouter>;
	}
}
