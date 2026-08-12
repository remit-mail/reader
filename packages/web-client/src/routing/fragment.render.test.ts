/**
 * `useRetainOpenPanels` reads the tier off the app's own desktop breakpoint
 * (#777), so a navigation below it lands without the rail in the address —
 * which is what keeps the drawer with the thread it was opened for.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	useNavigate,
} from "@tanstack/react-router";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { useRetainOpenPanels } from "./fragment";

const PHONE_WIDTH = 390;
const DESKTOP_WIDTH = 1440;

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

function CloseThread() {
	const navigate = useNavigate();
	const retainPanels = useRetainOpenPanels();
	return createElement(
		"button",
		{
			type: "button",
			onClick: () => {
				void navigate({ to: "/mail", hash: retainPanels });
			},
		},
		"Back",
	);
}

const rootRoute = createRootRoute();
const listRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mail",
});
const threadRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mail/thread",
	component: CloseThread,
});

const openDrawerOverThread = (): AnyRouter =>
	createRouter({
		routeTree: rootRoute.addChildren([listRoute, threadRoute]),
		history: createMemoryHistory({
			initialEntries: ["/mail/thread#intelligence"],
		}),
	}) as unknown as AnyRouter;

const walkUpToTheList = async (viewportWidth: number): Promise<AnyRouter> => {
	const router = openDrawerOverThread();
	harness = createDomHarness({ viewportWidth });
	// Resolve the first match before mounting: `RouterProvider` renders its
	// pending state until the router has loaded, and nothing here waits for it.
	await router.load();
	harness.render(createElement(RouterProvider, { router }));
	await harness.flush();
	harness.click(harness.byText("button", "Back"));
	await harness.flush();
	await harness.wait(20);
	return router;
};

describe("useRetainOpenPanels (#777)", () => {
	it("leaves the drawer behind on a phone", async () => {
		const router = await walkUpToTheList(PHONE_WIDTH);

		assert.equal(router.state.location.pathname, "/mail");
		assert.equal(router.state.location.hash, "");
	});

	it("carries the rail across on desktop, where it is a pane", async () => {
		const router = await walkUpToTheList(DESKTOP_WIDTH);

		assert.equal(router.state.location.pathname, "/mail");
		assert.equal(router.state.location.hash, "intelligence");
	});
});
