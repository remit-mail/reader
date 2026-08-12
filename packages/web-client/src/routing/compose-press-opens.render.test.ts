/**
 * Every Compose press opens a composer (#719).
 *
 * The press used to resolve a folder to carry the reader to, and could refuse:
 * a folder list still loading, or an account with no folders at all, left the
 * button doing nothing but complaining. A message needs no folder to be written
 * in now, so there is nothing left to refuse — including from `/mail` itself,
 * which names no list because it is on its way to the brief.
 *
 * Closing has the same shape from the other side. Leaving is what the reader
 * asked for, so every branch leaves rather than stranding them inside a surface
 * they have just dismissed.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { useCloseCompose, useOpenCompose } from "./compose";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const MAILBOX_ID = "mbx-inbox";

const Press = () => {
	const openCompose = useOpenCompose();
	const closeCompose = useCloseCompose();
	return createElement(
		"div",
		null,
		createElement(
			"button",
			{ type: "button", onClick: () => openCompose() },
			"Compose",
		),
		createElement(
			"button",
			{ type: "button", onClick: () => closeCompose() },
			"Close",
		),
	);
};

const RootLayout = () =>
	createElement("div", null, createElement(Press), createElement(Outlet));

/**
 * The real shape: the lists are siblings under `/mail`, and compose is a child
 * of each. `/mail` itself matches no list, which is the address the redirect to
 * the brief passes through.
 */
const routerAt = (href: string): AnyRouter => {
	const rootRoute = createRootRoute({ component: RootLayout });
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		validateSearch: (search: Record<string, unknown>) => search,
		component: Outlet,
	});
	const briefRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/brief",
		component: Outlet,
	});
	const mailboxRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/$mailboxId",
		component: Outlet,
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([
			briefRoute.addChildren([
				createRoute({
					getParentRoute: () => briefRoute,
					path: "/compose/{-$outboxMessageId}",
					component: () => null,
				}),
			]),
			mailboxRoute.addChildren([
				createRoute({
					getParentRoute: () => mailboxRoute,
					path: "/compose/{-$outboxMessageId}",
					component: () => null,
				}),
			]),
		]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [href] }),
	}) as unknown as AnyRouter;
};

const mount = async (router: AnyRouter): Promise<DomHarness> => {
	const created = createDomHarness();
	harness = created;
	// Resolve the first match before mounting: `RouterProvider` renders its
	// pending state until the router has loaded, and nothing here waits for it.
	await router.load();
	created.renderApp(createElement(RouterProvider, { router }));
	await created.flush();
	await created.wait(20);
	return created;
};

const press = async (mounted: DomHarness, label: string): Promise<void> => {
	mounted.click(mounted.byText("button", label));
	await mounted.flush();
	await mounted.wait(20);
};

describe("a compose press always opens a composer", () => {
	it("opens on the list being browsed", async () => {
		const router = routerAt("/mail/brief");
		const mounted = await mount(router);

		await press(mounted, "Compose");

		assert.equal(router.state.location.pathname, "/mail/brief/compose");
	});

	it("opens on the folder being browsed", async () => {
		const router = routerAt(`/mail/${MAILBOX_ID}`);
		const mounted = await mount(router);

		await press(mounted, "Compose");

		assert.equal(router.state.location.pathname, `/mail/${MAILBOX_ID}/compose`);
	});

	// The address the redirect to the brief passes through. It names no list, and
	// the press still has to write a message rather than report that it cannot.
	it("opens from an address that names no list at all", async () => {
		const router = routerAt("/mail");
		const mounted = await mount(router);

		await press(mounted, "Compose");

		assert.equal(router.state.location.pathname, "/mail/brief/compose");
	});
});

describe("closing compose always leaves", () => {
	it("walks up to the list the surface was opened on", async () => {
		const router = routerAt(`/mail/${MAILBOX_ID}/compose`);
		const mounted = await mount(router);

		await press(mounted, "Close");

		assert.equal(router.state.location.pathname, `/mail/${MAILBOX_ID}`);
	});

	it("lands somewhere real from an address that names no list", async () => {
		const router = routerAt("/mail");
		const mounted = await mount(router);

		await press(mounted, "Close");

		assert.equal(router.state.location.pathname, "/mail/brief");
	});
});
