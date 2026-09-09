/**
 * Where the search mirror writes, now that a list's open thread is a path
 * segment (#718).
 *
 * Mirroring `q` used to be one navigation with one destination, because the
 * thread travelled in the query and `...prev` carried it along. It is now two:
 * a query going active closes the reading pane, and that close is the address
 * walking up to the list — while every other write has to keep the address it
 * found, or clearing the search would shut the conversation being read.
 *
 * Driven through a real router over each list's real route shape, because the
 * whole question is what the router resolves a destination to from a thread
 * route under it. Reasoning about `to: "."` is not evidence. The brief and the
 * flagged list share this exact shape — a flat/sectioned list with a
 * `$threadId/$messageId` pair below it — so the two are driven through the
 * same cases rather than one covering for the other.
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
import { useSearchMirror } from "./search-mirror";

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

const mailContext = (
	input: string,
	committed: string,
	searchViewKey: string,
): MailContextValue => ({
	accounts: [],
	mailboxNameIndex: new Map(),
	accountNameIndex: new Map(),
	resultFolderIndex: EMPTY_RESULT_FOLDER_INDEX,
	searchQuery: committed,
	searchInput: input,
	searchViewKey,
	onSearchChange: () => {},
	onSearchClear: () => {},
	onSearchClearQuery: () => {},
	intelligenceOpen: false,
	onToggleIntelligence: () => {},
	onRaiseIntelligence: () => {},
});

type ListPath = "/mail/brief" | "/mail/flagged";

/**
 * Both lists' shape: the list is a layout route and the thread and message
 * are segments under it, so a write from the list has a matched child to
 * lose.
 */
const routerAt = (listPath: ListPath, href: string): AnyRouter => {
	const listSegment = listPath.slice("/mail".length);
	const rootRoute = createRootRoute({ component: Outlet });
	const passthrough = (search: Record<string, unknown>) => search;
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		validateSearch: passthrough,
		component: Outlet,
	});
	const listRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: listSegment,
		validateSearch: passthrough,
		component: () => {
			useSearchMirror({ to: listPath });
			return createElement(Outlet);
		},
	});
	const threadRoute = createRoute({
		getParentRoute: () => listRoute,
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
			listRoute.addChildren([threadRoute.addChildren([messageRoute])]),
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
	searchViewKey: string,
): Promise<DomHarness> => {
	const created = createDomHarness();
	harness = created;
	await router.load();
	created.renderApp(
		createElement(
			MailContext.Provider,
			{ value: mailContext(input, committed, searchViewKey) },
			createElement(RouterProvider, { router }),
		),
	);
	await created.flush();
	await created.wait(20);
	return created;
};

const LIST_PATHS: ListPath[] = ["/mail/brief", "/mail/flagged"];

for (const listPath of LIST_PATHS) {
	const threadHref = `${listPath}/${THREAD_ID}/${MESSAGE_ID}`;

	describe(`mirroring a query that goes active (${listPath})`, () => {
		it("walks up to the list, so no thread stays matched behind the results", async () => {
			const router = routerAt(listPath, threadHref);
			await mount(router, "invoice", "invoice", listPath);

			assert.equal(router.history.location.pathname, listPath);
			assert.match(router.history.location.search, /q=invoice/);
		});

		it("closes the pane from a bare thread address too", async () => {
			const router = routerAt(listPath, `${listPath}/${THREAD_ID}`);
			await mount(router, "invoice", "invoice", listPath);

			assert.equal(router.history.location.pathname, listPath);
		});

		it("replaces rather than pushes, so Back is not a search step", async () => {
			const router = routerAt(listPath, threadHref);
			const before = router.history.length;
			await mount(router, "invoice", "invoice", listPath);

			assert.equal(router.history.length, before);
		});
	});

	describe(`mirroring a cleared query (${listPath})`, () => {
		it("keeps the conversation open — dropping the search is not closing it", async () => {
			const router = routerAt(listPath, `${threadHref}?q=invoice`);
			await mount(router, "", "", listPath);

			assert.equal(router.history.location.pathname, threadHref);
			assert.equal(router.history.location.search.includes("q="), false);
		});

		it("leaves the address alone when there is nothing to write", async () => {
			const router = routerAt(listPath, `${threadHref}?q=invoice`);
			await mount(router, "invoice", "invoice", listPath);

			assert.equal(router.history.location.pathname, threadHref);
			assert.match(router.history.location.search, /q=invoice/);
		});

		it("waits for the debounce rather than writing the previous query", async () => {
			const router = routerAt(listPath, threadHref);
			await mount(router, "invo", "", listPath);

			assert.equal(router.history.location.pathname, threadHref);
			assert.equal(router.history.location.search.includes("q="), false);
		});
	});
}

/**
 * The other half of why a typed query survives an opened thread: the field
 * re-seeds on a view change, so the view key of the list and of the thread route
 * under it must be equal.
 *
 * Read off the address the router committed for a real navigation, so the keys
 * under test are the ones path segments produce rather than ids written out
 * here.
 */
describe("the view key of an open thread", () => {
	const viewKeyAt = async (
		listPath: ListPath,
		href: string,
	): Promise<string> => {
		const router = routerAt(listPath, href);
		await router.load();
		return mailViewKey(router.state.location.pathname);
	};

	for (const listPath of LIST_PATHS) {
		it(`is the list's own, thread and message segments alike (${listPath})`, async () => {
			const list = await viewKeyAt(listPath, listPath);
			assert.notEqual(list, "", "the list resolves to a view key at all");
			assert.equal(await viewKeyAt(listPath, `${listPath}/${THREAD_ID}`), list);
			assert.equal(
				await viewKeyAt(listPath, `${listPath}/${THREAD_ID}/${MESSAGE_ID}`),
				list,
			);
		});
	}
});
