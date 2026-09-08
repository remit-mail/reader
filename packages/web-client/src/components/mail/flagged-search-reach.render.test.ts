/**
 * A search of the Starred collection is the listing narrowed, not a second
 * query beside it.
 *
 * It used to be a second query: one uncontinuable page, with no error state and
 * no loading state of its own. Three things followed, and none of them is
 * visible from a unit test of the criteria — only from the screen.
 *
 * A failed search rendered as "no matches". The generated client throws on a
 * 401, the hook swallowed it (`data?.items ?? []`), and an expired session was
 * indistinguishable from a collection holding nothing — the reading the
 * no-silent-auth-failure rule exists to forbid.
 *
 * "Load more" was dead under a query: the button read `hasNextPage` off the
 * listing query while the rows came from the search one, so it either did not
 * appear or fetched a page nothing rendered.
 *
 * And the empty state flashed: `listState` read the listing's loading flag, so
 * a cached listing beside an in-flight search said "no matches" before the
 * search had answered.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
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
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { MailContext, type MailContextValue } from "@/lib/mail-context";
import { MailFreshnessProvider } from "@/lib/mail-freshness";
import { EMPTY_RESULT_FOLDER_INDEX } from "@/lib/result-folder";
import { useOpenThreadPath } from "@/routing";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeThreadMessage } from "@/test-support/fixtures";
import {
	type HttpCall,
	type HttpMock,
	httpError,
	mockFetch,
} from "@/test-support/http";
import { FlaggedPane } from "./FlaggedPane";

const QUERY = "concierge";
const DESKTOP_WIDTH = 1440;

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const match = (index: number): RemitImapThreadMessageResponse =>
	makeThreadMessage({
		messageId: `match-${index}`,
		threadId: `thread-match-${index}`,
		subject: `Parcel ${index}`,
		snippet: "Your parcel was left with the concierge",
		hasStars: true,
		sentDate: 1_767_225_600_000 - index * 1_000,
	});

/** A full page, so the server hands back a continuation token with it. */
const FIRST_PAGE = Array.from({ length: 50 }, (_, index) => match(index));
const SECOND_PAGE = [match(50)];

const mailContext = (query: string): MailContextValue => ({
	accounts: [],
	mailboxNameIndex: new Map(),
	accountNameIndex: new Map(),
	resultFolderIndex: EMPTY_RESULT_FOLDER_INDEX,
	searchQuery: query,
	searchInput: query,
	searchViewKey: "list",
	onSearchChange: () => undefined,
	onSearchClear: () => undefined,
	onSearchClearQuery: () => undefined,
	intelligenceOpen: false,
	onToggleIntelligence: () => undefined,
	onRaiseIntelligence: () => undefined,
});

const testRouter = (query: string): AnyRouter => {
	const rootRoute = createRootRoute({
		component: () =>
			createElement(MailFreshnessProvider, {
				accountIds: [],
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
				children: createElement(
					MailContext.Provider,
					{ value: mailContext(query) },
					createElement(ComposeProvider, null, createElement(Outlet)),
				),
			}),
	});
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		validateSearch: (search: Record<string, unknown>) => search,
		component: Outlet,
	});
	const flaggedRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/flagged",
		component: () =>
			createElement(FlaggedPane, {
				thread: useOpenThreadPath(),
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
				children: createElement(FlaggedPane.List),
			}),
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([flaggedRoute]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: ["/mail/flagged"] }),
	}) as unknown as AnyRouter;
};

const threadCalls = (): HttpCall[] =>
	(http?.calls ?? []).filter(
		(call) => new URL(call.url, "http://localhost").pathname === "/threads",
	);

const paramsOf = (call: HttpCall): URLSearchParams =>
	new URL(call.url, "http://localhost").searchParams;

const mount = async (
	answer: (call: HttpCall) => unknown,
	query = QUERY,
): Promise<DomHarness> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [] };
		if (call.path !== "/threads") return { items: [] };
		return answer(call);
	});

	const router = testRouter(query);
	await router.load();
	const mounted = createDomHarness({ viewportWidth: DESKTOP_WIDTH });
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
	return mounted;
};

/** The rows request: the count reads `results=false` and carries no rows. */
const isRowRequest = (call: HttpCall): boolean =>
	paramsOf(call).get("results") !== "false";

describe("a Starred search reaches the whole collection (#1128, #1135)", () => {
	// The failure the no-silent-auth-failure rule names: a 401 that renders as
	// an empty result is indistinguishable from a collection holding nothing, so
	// the reader concludes their mail is gone rather than their session.
	it("says a failed search failed, never that nothing matched", async () => {
		// Only the search fails. The pane's own unnarrowed listing answers, which
		// is what let the failure hide: the view read its error state off that
		// healthy query while rendering rows from the failed one.
		const mounted = await mount((call) =>
			isRowRequest(call) && paramsOf(call).get("query")
				? httpError(401, "Session expired")
				: { items: [] },
		);

		await mounted.waitFor(
			() => mounted.text().includes("Couldn't load messages"),
			"the failed search to state itself",
		);

		const shown = mounted.text();
		assert.ok(
			!/No .*matching/i.test(shown) && !/No messages in Starred/.test(shown),
			`a failed search rendered as an empty collection: ${shown.slice(0, 300)}`,
		);
		assert.ok(
			[...mounted.queryAll("button")].some(
				(button) => (button.textContent ?? "").trim() === "Retry",
			),
			"the failure offered no way to retry",
		);
	});

	// The dead button: the rows came from a query with no continuation, so the
	// control that asks for more of them had nothing to ask.
	it("pages a search past its first page", async () => {
		const mounted = await mount((call) => {
			if (!isRowRequest(call)) return { count: FIRST_PAGE.length + 1 };
			return paramsOf(call).get("continuationToken")
				? { items: SECOND_PAGE }
				: { items: FIRST_PAGE, continuationToken: "page-2" };
		});

		await mounted.waitFor(
			() => mounted.text().includes("Parcel 0"),
			"the first page of matches",
		);

		const loadMore = [...mounted.queryAll("button")].find((button) =>
			(button.textContent ?? "").includes("Load more"),
		);
		assert.ok(loadMore, "a search with more matches offered no way to them");

		mounted.click(loadMore);
		await mounted.waitFor(
			() => mounted.text().includes("Parcel 50"),
			"the second page of matches",
		);

		const paged = threadCalls().filter(
			(call) => isRowRequest(call) && paramsOf(call).get("continuationToken"),
		);
		assert.equal(paged.length, 1, "the second page was never requested");
		assert.equal(
			paramsOf(paged[0]).get("query"),
			QUERY,
			"the next page dropped the search text",
		);
	});

	// One request answers the rows under a query, so the free text travels with
	// every other criterion rather than in a second query beside them. (The pane
	// keeps its own unnarrowed listing for selection resolution; that one carries
	// no text and is not this.)
	it("asks for the matches once, on the listing request", async () => {
		const mounted = await mount(() => ({ items: FIRST_PAGE.slice(0, 2) }));
		await mounted.waitFor(
			() => mounted.text().includes("Parcel 0"),
			"the matches to render",
		);

		const searched = threadCalls().filter(
			(call) => isRowRequest(call) && paramsOf(call).get("query") === QUERY,
		);
		assert.equal(searched.length, 1, "the search fanned out into two requests");
		assert.equal(paramsOf(searched[0]).get("starred"), "true");
	});

	// The reach sentence is read off the request. A narrowing token beside the
	// free text is what puts the sentence on screen, and both are parameters
	// now, so the honest claim is the whole collection — which is only true
	// because the search pages to its end rather than stopping at one window.
	it("claims the whole collection was checked when nothing matched", async () => {
		const mounted = await mount(
			(call) => (isRowRequest(call) ? { items: [] } : { count: 0 }),
			`is:unread ${QUERY}`,
		);

		await mounted.waitFor(
			() => mounted.text().includes("No "),
			"the empty search to settle",
		);
		assert.match(mounted.text(), /Every message in this folder was checked\./);
	});
});
