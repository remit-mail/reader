/**
 * Issue #703: compose state opened with nothing mounting the surface, so the
 * button looked dead and the window turned up on the next navigation.
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
import { createElement, useEffect, useState } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, mockFetch } from "../../test-support/http";
import { ComposeProvider, useCompose } from "./ComposeProvider";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let releaseMailboxes: (() => void) | undefined;

afterEach(() => {
	releaseMailboxes?.();
	releaseMailboxes = undefined;
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const ACCOUNT_ID = "acc-1";
const INBOX_ID = "mbx-inbox";

const ComposeProbe = () => {
	const { state, openCompose } = useCompose();
	return createElement(
		"button",
		{
			type: "button",
			"data-open": String(state.isOpen),
			onClick: () => openCompose({ mode: "new" }),
		},
		"Compose",
	);
};

// The provider sits at the root the way `__root.tsx` mounts it, so navigation
// reaches it the way it does in the app.
const RootLayout = () =>
	createElement(
		ComposeProvider,
		null,
		createElement(ComposeProbe),
		createElement(Outlet),
	);

/**
 * The folder's real shape: the thread and the message are segments under the
 * list, so an open conversation is something the address holds and compose has
 * to navigate out of.
 */
const routerAt = (href: string, layout = RootLayout): AnyRouter => {
	const rootRoute = createRootRoute({ component: layout });
	const mailboxRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail/$mailboxId",
		validateSearch: (search: Record<string, unknown>) => search,
		component: Outlet,
	});
	const threadRoute = createRoute({
		getParentRoute: () => mailboxRoute,
		path: "/$threadId",
		component: Outlet,
	});
	const messageRoute = createRoute({
		getParentRoute: () => threadRoute,
		path: "/$messageId",
		component: () => null,
	});
	const routeTree = rootRoute.addChildren([
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/mail/outbox",
			validateSearch: (search: Record<string, unknown>) => search,
			component: () => null,
		}),
		mailboxRoute.addChildren([threadRoute.addChildren([messageRoute])]),
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/settings",
			component: () => null,
		}),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [href] }),
	}) as unknown as AnyRouter;
};

interface MountOptions {
	/** Hold the folder list open, so no target has resolved at press time. */
	holdMailboxes?: boolean;
	/** Answer with an account that has no folders at all. */
	noMailboxes?: boolean;
}

const mount = async (
	router: AnyRouter,
	options: MountOptions = {},
): Promise<DomHarness> => {
	const held = options.holdMailboxes
		? new Promise<void>((resolve) => {
				releaseMailboxes = resolve;
			})
		: undefined;

	http = mockFetch(async (call) => {
		if (call.path.endsWith("/config")) {
			return {
				accounts: [
					{
						accountId: ACCOUNT_ID,
						email: "me@example.com",
						folderAppointments: [{ role: "Inbox", mailboxId: INBOX_ID }],
					},
				],
			};
		}
		if (call.path.endsWith("/mailboxes")) {
			if (held) await held;
			if (options.noMailboxes) return { items: [] };
			return { items: [{ mailboxId: INBOX_ID, fullPath: "INBOX" }] };
		}
		return {};
	});

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

const press = async (mounted: DomHarness): Promise<HTMLElement> => {
	const button = mounted.byText("button", "Compose");
	mounted.click(button);
	await mounted.flush();
	await mounted.wait(20);
	return button;
};

const THREAD_HREF = `/mail/${INBOX_ID}/th-1/msg-1`;

describe("opening compose over an open message (#703)", () => {
	it("walks up to the list so the pane can render the surface", async () => {
		const router = routerAt(THREAD_HREF);
		const mounted = await mount(router);

		const button = mounted.byText("button", "Compose");
		assert.equal(button.getAttribute("data-open"), "false");

		await press(mounted);

		assert.equal(button.getAttribute("data-open"), "true");
		assert.equal(router.history.location.pathname, `/mail/${INBOX_ID}`);
	});

	it("keeps the query, so the search the user typed survives", async () => {
		const router = routerAt(`${THREAD_HREF}?q=invoice`);
		const mounted = await mount(router);

		await press(mounted);

		assert.equal(router.history.location.pathname, `/mail/${INBOX_ID}`);
		assert.match(router.history.location.search, /q=invoice/);
	});

	it("leaves the message one Back away rather than erasing it", async () => {
		const router = routerAt(THREAD_HREF);
		const mounted = await mount(router);

		await press(mounted);
		router.history.back();
		await mounted.flush();

		assert.equal(router.history.location.pathname, THREAD_HREF);
	});

	it("adds no history entry when the pane had nothing open", async () => {
		const router = routerAt(`/mail/${INBOX_ID}`);
		const mounted = await mount(router);
		const entries = router.history.length;

		await press(mounted);

		assert.equal(router.history.length, entries);
	});

	it("carries a compose started off the outbox to a route that mounts it", async () => {
		const router = routerAt("/mail/outbox");
		const mounted = await mount(router);

		const button = await press(mounted);

		assert.equal(button.getAttribute("data-open"), "true");
		assert.equal(router.history.location.pathname, `/mail/${INBOX_ID}`);
	});
});

// Walking off the routes that mount the surface closes it. That rule reads the
// live location, which this harness does not advance — `RouterProvider` here
// serves its first match and stays there — so it is pinned in the e2e suite
// (`compose-over-open-message.spec.ts`) instead. What is checked here is the
// half that would break it: opening compose navigates, and the surface has to
// survive its own navigation.
describe("compose survives the navigation that opens it (#703)", () => {
	it("stays open when the press carried the user to another route", async () => {
		const router = routerAt("/mail/outbox");
		const mounted = await mount(router);

		const button = await press(mounted);

		assert.equal(router.history.location.pathname, `/mail/${INBOX_ID}`);
		assert.equal(button.getAttribute("data-open"), "true");
	});
});

describe("the open call is stable", () => {
	// A fresh `openCompose` on every render is a loop, not a nuisance: callers
	// hold it in dependency arrays, and one of them opens compose from an effect.
	it("hands back the same function across a re-render", async () => {
		const identities = new Set<unknown>();
		const CountingProbe = () => {
			const { openCompose } = useCompose();
			const [bumped, setBumped] = useState(0);
			useEffect(() => {
				identities.add(openCompose);
			}, [openCompose]);
			return createElement(
				"button",
				{ type: "button", onClick: () => setBumped(bumped + 1) },
				`Bump ${bumped}`,
			);
		};
		const CountingLayout = () =>
			createElement(
				ComposeProvider,
				null,
				createElement(CountingProbe),
				createElement(Outlet),
			);

		const mounted = await mount(routerAt(`/mail/${INBOX_ID}`, CountingLayout));
		// The target legitimately settles as config and the folder list land. What
		// must not happen is another identity after that, on a render that has
		// nothing to do with compose.
		const settled = identities.size;

		mounted.click(mounted.byText("button", "Bump"));
		await mounted.flush();
		await mounted.wait(20);

		assert.equal(mounted.byText("button", "Bump").textContent, "Bump 1");
		assert.equal(identities.size, settled);
	});
});

describe("a compose with nowhere to land says so", () => {
	it("opens nothing and reports it while the folder list is in flight", async () => {
		const router = routerAt("/mail/outbox");
		const mounted = await mount(router, { holdMailboxes: true });

		const button = await press(mounted);

		assert.equal(button.getAttribute("data-open"), "false");
		assert.equal(router.history.location.pathname, "/mail/outbox");
		assert.match(mounted.text(), /Not ready to write yet/);
	});

	it("names the fix when no account has a folder", async () => {
		const router = routerAt("/mail/outbox");
		const mounted = await mount(router, { noMailboxes: true });

		const button = await press(mounted);

		assert.equal(button.getAttribute("data-open"), "false");
		assert.match(mounted.text(), /Nowhere to write from/);
		assert.match(mounted.text(), /Settings/);
	});

	it("asks the API for nothing off the mail routes", async () => {
		const router = routerAt("/settings");
		await mount(router);

		assert.deepEqual(
			(http?.calls ?? []).map((call) => call.path),
			[],
		);
	});
});
