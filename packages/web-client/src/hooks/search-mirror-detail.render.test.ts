/**
 * Where the search mirror writes, now that the brief's open thread is a path
 * segment (#718).
 *
 * Mirroring `q` used to be one navigation with one destination, because the
 * thread travelled in the query and `...prev` carried it along. It is now two:
 * a query going active closes the reading pane, and that close is the address
 * walking up to the list — while every other write has to keep the address it
 * found, or clearing the search would shut the conversation being read.
 *
 * Driven through a real router over the brief's real route shape, because the
 * whole question is what the router resolves a destination to from a thread
 * route. Reasoning about `to: "."` is not evidence.
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
import { MailContext, type MailContextValue } from "@/lib/mail-context";
import { mailViewKey } from "@/lib/mail-route";
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

const THREAD_ID = "th-1";
const MESSAGE_ID = "msg-1";

const mailContext = (input: string, committed: string): MailContextValue => ({
	accounts: [],
	mailboxNameIndex: new Map(),
	accountNameIndex: new Map(),
	resultFolderIndex: EMPTY_RESULT_FOLDER_INDEX,
	searchQuery: committed,
	searchInput: input,
	searchViewKey: "/mail/brief",
	onSearchChange: () => {},
	onSearchClear: () => {},
	onSearchClearQuery: () => {},
	intelligenceOpen: false,
	onToggleIntelligence: () => {},
	onSetIntelligenceOpen: () => {},
});

/**
 * The brief's shape: the list is a layout route and the thread and message are
 * segments under it, so a write from the list has a matched child to lose.
 */
const routerAt = (href: string): AnyRouter => {
	const rootRoute = createRootRoute({ component: Outlet });
	const passthrough = (search: Record<string, unknown>) => search;
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
		component: () => {
			useSearchMirror({ to: "/mail/brief" });
			return createElement(Outlet);
		},
	});
	const threadRoute = createRoute({
		getParentRoute: () => briefRoute,
		path: "/$threadId",
		component: Outlet,
	});
	const messageRoute = createRoute({
		getParentRoute: () => threadRoute,
		path: "/$messageId",
		component: () => null,
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([
			briefRoute.addChildren([threadRoute.addChildren([messageRoute])]),
		]),
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

const threadHref = `/mail/brief/${THREAD_ID}/${MESSAGE_ID}`;

describe("mirroring a query that goes active", () => {
	it("walks up to the list, so no thread stays matched behind the results", async () => {
		const router = routerAt(threadHref);
		await mount(router, "invoice", "invoice");

		assert.equal(router.history.location.pathname, "/mail/brief");
		assert.match(router.history.location.search, /q=invoice/);
	});

	it("closes the pane from a bare thread address too", async () => {
		const router = routerAt(`/mail/brief/${THREAD_ID}`);
		await mount(router, "invoice", "invoice");

		assert.equal(router.history.location.pathname, "/mail/brief");
	});

	it("replaces rather than pushes, so Back is not a search step", async () => {
		const router = routerAt(threadHref);
		const before = router.history.length;
		await mount(router, "invoice", "invoice");

		assert.equal(router.history.length, before);
	});
});

describe("mirroring a cleared query", () => {
	it("keeps the conversation open — dropping the search is not closing it", async () => {
		const router = routerAt(`${threadHref}?q=invoice`);
		await mount(router, "", "");

		assert.equal(router.history.location.pathname, threadHref);
		assert.equal(router.history.location.search.includes("q="), false);
	});

	it("leaves the address alone when there is nothing to write", async () => {
		const router = routerAt(`${threadHref}?q=invoice`);
		await mount(router, "invoice", "invoice");

		assert.equal(router.history.location.pathname, threadHref);
		assert.match(router.history.location.search, /q=invoice/);
	});

	it("waits for the debounce rather than writing the previous query", async () => {
		const router = routerAt(threadHref);
		await mount(router, "invo", "");

		assert.equal(router.history.location.pathname, threadHref);
		assert.equal(router.history.location.search.includes("q="), false);
	});
});

/**
 * The other half of why a typed query survives an opened thread: the field
 * re-seeds on a view change, so the view key of the list and of the thread route
 * under it must be equal.
 *
 * Read off the matches the router resolved for a real address, so the ids under
 * test are the ones path segments produce rather than ids written out here.
 */
describe("the view key of an open brief thread", () => {
	const viewKeyAt = async (href: string): Promise<string> => {
		const router = routerAt(href);
		await router.load();
		return mailViewKey(
			router.state.matches.map((match: { routeId: string }) => ({
				routeId: match.routeId,
			})),
		);
	};

	it("is the brief's own, thread and message segments alike", async () => {
		const list = await viewKeyAt("/mail/brief");
		assert.notEqual(list, "", "the brief resolves to a view key at all");
		assert.equal(await viewKeyAt(`/mail/brief/${THREAD_ID}`), list);
		assert.equal(await viewKeyAt(threadHref), list);
	});
});
