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
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, mockFetch } from "../../test-support/http";
import { ComposeProvider, useCompose } from "./ComposeProvider";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

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

const rootRoute = createRootRoute();
const mailboxRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mail/$mailboxId",
	validateSearch: (search: Record<string, unknown>) => search,
});
const outboxRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mail/outbox",
	validateSearch: (search: Record<string, unknown>) => search,
});

const routerAt = (href: string): AnyRouter =>
	createRouter({
		routeTree: rootRoute.addChildren([outboxRoute, mailboxRoute]),
		history: createMemoryHistory({ initialEntries: [href] }),
	}) as unknown as AnyRouter;

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

let releaseMailboxes: (() => void) | undefined;

/** The mailbox list held open, so the target is unresolved at press time. */
const mountWithHeldMailboxes = async (
	router: AnyRouter,
): Promise<DomHarness> => {
	const held = new Promise<void>((resolve) => {
		releaseMailboxes = resolve;
	});
	return mount(router, held);
};

const mount = async (
	router: AnyRouter,
	holdMailboxes?: Promise<void>,
): Promise<DomHarness> => {
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
			if (holdMailboxes) await holdMailboxes;
			return { items: [{ mailboxId: INBOX_ID, fullPath: "INBOX" }] };
		}
		return {};
	});

	const created = createDomHarness();
	const provided = createElement(
		ComposeProvider,
		null,
		createElement(ComposeProbe),
	);
	created.renderApp(
		createElement(RouterContextProvider, {
			router,
			// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
			children: provided,
		}),
	);
	await created.flush();
	await created.wait(20);
	harness = created;
	return created;
};

const press = async (mounted: DomHarness): Promise<HTMLElement> => {
	const button = mounted.byText("button", "Compose");
	mounted.click(button);
	await mounted.flush();
	await mounted.wait(20);
	return button;
};

describe("opening compose over an open message (#703)", () => {
	it("drops the selected message so the pane can render the surface", async () => {
		const router = routerAt(
			`/mail/${INBOX_ID}?selectedMessageId=msg-1&selectedThreadId=th-1`,
		);
		const mounted = await mount(router);

		const button = mounted.byText("button", "Compose");
		assert.equal(button.getAttribute("data-open"), "false");

		await press(mounted);

		assert.equal(button.getAttribute("data-open"), "true");
		assert.equal(router.history.location.pathname, `/mail/${INBOX_ID}`);
		const search = router.history.location.search;
		assert.equal(search.includes("selectedMessageId"), false);
		assert.equal(search.includes("selectedThreadId"), false);
	});

	it("keeps the rest of the query, so the search the user typed survives", async () => {
		const router = routerAt(
			`/mail/${INBOX_ID}?q=invoice&selectedMessageId=msg-1`,
		);
		const mounted = await mount(router);

		await press(mounted);

		const search = router.history.location.search;
		assert.equal(search.includes("selectedMessageId"), false);
		assert.match(search, /q=invoice/);
	});

	it("leaves the message one Back away rather than erasing it", async () => {
		const router = routerAt(`/mail/${INBOX_ID}?selectedMessageId=msg-1`);
		const mounted = await mount(router);

		await press(mounted);
		router.history.back();
		await mounted.flush();

		assert.match(router.history.location.search, /selectedMessageId=msg-1/);
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

	it("holds a press made before the target mailbox is known", async () => {
		const router = routerAt("/mail/outbox");
		const mounted = await mountWithHeldMailboxes(router);

		const button = mounted.byText("button", "Compose");
		mounted.click(button);
		await mounted.flush();

		// Nothing to mount the surface yet, so nothing is open — and the press is
		// not thrown away either.
		assert.equal(button.getAttribute("data-open"), "false");
		assert.equal(router.history.location.pathname, "/mail/outbox");

		releaseMailboxes?.();
		await mounted.flush();
		await mounted.wait(50);

		assert.equal(button.getAttribute("data-open"), "true");
		assert.equal(router.history.location.pathname, `/mail/${INBOX_ID}`);
	});
});
