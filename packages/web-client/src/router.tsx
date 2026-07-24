import type { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
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
