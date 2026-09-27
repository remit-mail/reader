import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
} from "@tanstack/react-router";
import { createElement, type FunctionComponent } from "react";

(globalThis as { self?: typeof globalThis }).self ??= globalThis;

/**
 * The brief's thread routes, with `surface` mounted above them so it stays on
 * screen while the address moves. A surface that opens a conversation is
 * asserted by where the router lands, not by the callback it was handed.
 */
export const threadRouter = (
	surface: FunctionComponent,
	path: string,
): AnyRouter => {
	const rootRoute = createRootRoute({
		component: () =>
			createElement("div", null, createElement(surface), createElement(Outlet)),
	});
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		component: Outlet,
	});
	const briefRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/brief",
		component: Outlet,
	});
	const threadRoute = createRoute({
		getParentRoute: () => briefRoute,
		path: "$threadId",
		component: Outlet,
	});
	const messageRoute = createRoute({
		getParentRoute: () => threadRoute,
		path: "$messageId",
		component: Outlet,
	});
	return createRouter({
		routeTree: rootRoute.addChildren([
			mailRoute.addChildren([
				briefRoute.addChildren([threadRoute.addChildren([messageRoute])]),
			]),
		]),
		history: createMemoryHistory({ initialEntries: [path] }),
	}) as unknown as AnyRouter;
};
