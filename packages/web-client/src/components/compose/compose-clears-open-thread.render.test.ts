/**
 * Opening compose closes whatever the reading pane had open (#703).
 *
 * The pane renders one of the two, so compose state that opens while a message
 * is still selected has nothing mounting it — the button looked dead until an
 * unrelated navigation dropped the selection, and the surface then appeared on
 * its own. The selection is dropped by `openCompose` itself so every entry point
 * gets it, which is what this pins: one call, and the URL no longer names a
 * message.
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
import { ComposeProvider, useCompose } from "./ComposeProvider";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const rootRoute = createRootRoute();
const mailboxRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mail/$mailboxId",
	validateSearch: (search: Record<string, unknown>) => search,
});

const routerAt = (href: string): AnyRouter =>
	createRouter({
		routeTree: rootRoute.addChildren([mailboxRoute]),
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

const mount = (router: AnyRouter): DomHarness => {
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
	return created;
};

describe("opening compose over an open message (#703)", () => {
	it("drops the selected message so the pane can render the surface", async () => {
		const router = routerAt(
			"/mail/mbx-1?selectedMessageId=msg-1&selectedThreadId=th-1",
		);
		harness = mount(router);

		const button = harness.byText("button", "Compose");
		assert.equal(button.getAttribute("data-open"), "false");

		harness.click(button);
		await harness.flush();

		assert.equal(button.getAttribute("data-open"), "true");
		const search = router.history.location.search;
		assert.equal(search.includes("selectedMessageId"), false);
		assert.equal(search.includes("selectedThreadId"), false);
	});

	it("keeps the rest of the query, so the search the user typed survives", async () => {
		const router = routerAt("/mail/mbx-1?q=invoice&selectedMessageId=msg-1");
		harness = mount(router);

		harness.click(harness.byText("button", "Compose"));
		await harness.flush();

		const search = router.history.location.search;
		assert.equal(search.includes("selectedMessageId"), false);
		assert.match(search, /q=invoice/);
	});
});
