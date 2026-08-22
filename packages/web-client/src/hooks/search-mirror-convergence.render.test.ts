/**
 * The mirror corrects an address that has drifted from the settled query
 * (#808).
 *
 * Typing lands more than one navigation: the debounce settles mid-word, the
 * mirror writes that prefix, and the word is finished while that write is still
 * in flight. The two can commit out of order, and an e2e run caught the result
 * — the field holding `invoice`, the address holding `q=invo`, and neither
 * moving again for the remaining two minutes of the test. The mirror compared
 * against the URL without re-running on it, so a disagreement it had not caused
 * was permanent.
 *
 * Driven through a real router, because the state under test is one only the
 * router can produce: the address is moved out from under a mirror that has
 * already settled, with the field and the committed query left where they were.
 * The re-render is provoked rather than awaited — this harness does not
 * propagate a router store change into React on its own, where the running app
 * renders on every `q` — so what each case actually asks is whether the mirror
 * reconsiders once it renders again.
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
import { createElement, useState } from "react";
import { MailContext, type MailContextValue } from "@/lib/mail-context";
import { EMPTY_RESULT_FOLDER_INDEX } from "@/lib/result-folder";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { useSearchMirror } from "./useSearchMirror";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const LIST_PATH = "/mail/brief";
const RENDER_AGAIN = "render again";

const mailContext = (input: string, committed: string): MailContextValue => ({
	accounts: [],
	mailboxNameIndex: new Map(),
	accountNameIndex: new Map(),
	resultFolderIndex: EMPTY_RESULT_FOLDER_INDEX,
	searchQuery: committed,
	searchInput: input,
	searchViewKey: LIST_PATH,
	onSearchChange: () => {},
	onSearchClear: () => {},
	onSearchClearQuery: () => {},
	intelligenceOpen: false,
	onToggleIntelligence: () => {},
	onRaiseIntelligence: () => {},
});

/**
 * The brief on its own. Where a correcting write lands, and what it may close
 * under it, is `search-mirror-detail.render.test.ts`'s question; this file asks
 * only whether the address ends up saying the settled query.
 */
const buildRouter = (href: string): AnyRouter => {
	const passthrough = (search: Record<string, unknown>) => search;
	const rootRoute = createRootRoute({ component: Outlet });
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		validateSearch: passthrough,
		component: Outlet,
	});
	const briefRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/brief",
		validateSearch: passthrough,
		component: function BriefLayout() {
			const [renders, setRenders] = useState(0);
			useSearchMirror({ to: LIST_PATH });
			return createElement(
				"div",
				null,
				createElement(
					"button",
					{
						type: "button",
						"aria-label": RENDER_AGAIN,
						onClick: () => setRenders(renders + 1),
					},
					String(renders),
				),
				createElement(Outlet),
			);
		},
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([briefRoute]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [href] }),
	}) as unknown as AnyRouter;
};

const mount = async (
	router: AnyRouter,
	input: string,
	committed: string,
): Promise<DomHarness> => {
	const created = createDomHarness();
	harness = created;
	await router.load();
	created.renderApp(
		createElement(
			MailContext.Provider,
			{ value: mailContext(input, committed) },
			createElement(RouterProvider, { router }),
		),
	);
	await created.flush();
	await created.wait(20);
	return created;
};

/**
 * The write that was still in flight, landing after the one that followed it,
 * and then the next render of the list it landed under.
 */
const driftTo = async (
	created: DomHarness,
	router: AnyRouter,
	q: string | undefined,
): Promise<void> => {
	void router.navigate({ to: ".", search: { q }, replace: true });
	await created.wait(20);
	created.click(created.byLabel(RENDER_AGAIN));
	await created.wait(50);
};

describe("an address that drifts from the settled query", () => {
	it("is written again, rather than left on the prefix", async () => {
		const router = buildRouter(`${LIST_PATH}?q=invoice`);
		const created = await mount(router, "invoice", "invoice");
		assert.match(router.history.location.search, /q=invoice/);

		await driftTo(created, router, "invo");

		assert.match(
			router.history.location.search,
			/q=invoice/,
			"the mirror never reconsidered the address it had already agreed with",
		);
		assert.equal(router.history.location.pathname, LIST_PATH);
	});

	it("is written again when the query was dropped from it entirely", async () => {
		const router = buildRouter(`${LIST_PATH}?q=invoice`);
		const created = await mount(router, "invoice", "invoice");

		await driftTo(created, router, undefined);

		assert.match(router.history.location.search, /q=invoice/);
	});

	it("leaves an address that already says the settled query alone", async () => {
		const router = buildRouter(`${LIST_PATH}?q=invoice`);
		const created = await mount(router, "invoice", "invoice");
		const before = router.history.length;

		await driftTo(created, router, "invoice");

		assert.match(router.history.location.search, /q=invoice/);
		assert.equal(router.history.length, before);
	});

	it("does not fight a query arriving mid-debounce", async () => {
		// A deep link or a saved search lands while the field is still catching
		// up. The committed query is the previous one, so the mirror has nothing
		// settled to write and must not strip what just arrived.
		const router = buildRouter(`${LIST_PATH}?q=receipts`);
		const created = await mount(router, "invoice", "");

		created.click(created.byLabel(RENDER_AGAIN));
		await created.wait(50);

		assert.match(router.history.location.search, /q=receipts/);
	});
});
