/**
 * The result header states the server's count, not the length of the pages the
 * browser happens to hold (#307).
 *
 * `count={threads.length}` understated every search that matched more than one
 * page, and climbed as the reader scrolled. The number now comes from one
 * `count: true` request against the criteria — so it is right before any "load
 * more", and a page fetch never re-asks for it.
 *
 * The count is opt-in for a reason: a sub-three-character query falls out of the
 * trigram index onto a folded scan, so it is not counted while it is being
 * typed. The header renders without a number until it is.
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
import { createElement, type ReactNode } from "react";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { MailContext, type MailContextValue } from "@/lib/mail-context";
import { MailFreshnessProvider } from "@/lib/mail-freshness";
import { EMPTY_RESULT_FOLDER_INDEX } from "@/lib/result-folder";
import { useOpenThreadPath } from "@/routing";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeThreadMessage } from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { MailboxPane } from "./MailboxPane";

const MAILBOX_ID = "mbx-inbox";
const LIST_PATH = `/mail/${MAILBOX_ID}`;

/** One page of the search, well short of what the mailbox holds. */
const PAGE_SIZE = 50;
/** What the mailbox actually holds for this search — the number under test. */
const TOTAL_MATCHES = 1284;

const page: RemitImapThreadMessageResponse[] = Array.from(
	{ length: PAGE_SIZE },
	(_, i) =>
		makeThreadMessage({
			messageId: `msg-${i}`,
			threadId: `thread-${i}`,
			mailboxId: MAILBOX_ID,
			subject: `Invoice ${i}`,
		}),
);

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

function MailLayout({
	searchQuery,
	children,
}: {
	searchQuery: string;
	children: ReactNode;
}) {
	const value: MailContextValue = {
		accounts: [],
		mailboxNameIndex: new Map(),
		accountNameIndex: new Map(),
		resultFolderIndex: EMPTY_RESULT_FOLDER_INDEX,
		searchQuery,
		searchInput: searchQuery,
		searchViewKey: searchQuery,
		onSearchChange: () => {},
		onSearchClear: () => {},
		onSearchClearQuery: () => {},
		intelligenceOpen: false,
		onToggleIntelligence: () => {},
		onRaiseIntelligence: () => {},
	};
	return createElement(
		MailContext.Provider,
		{ value },
		createElement(MailFreshnessProvider, { accountIds: [], children }),
	);
}

const testRouter = (searchQuery: string): AnyRouter => {
	const rootRoute = createRootRoute({
		component: () =>
			createElement(
				ComposeProvider,
				null,
				createElement(MailLayout, {
					searchQuery,
					// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
					children: createElement(Outlet),
				}),
			),
	});
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		validateSearch: (search: Record<string, unknown>) => search,
		component: Outlet,
	});
	const mailboxRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/$mailboxId",
		component: () =>
			createElement(MailboxPane, {
				mailboxId: MAILBOX_ID,
				thread: useOpenThreadPath(),
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
				children: createElement(MailboxPane.List),
			}),
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([mailboxRoute]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [LIST_PATH] }),
	}) as unknown as AnyRouter;
};

/**
 * The server as the boundary describes it: a page of rows for a results
 * request, and the whole match set for a count-only one. The two never share a
 * response, which is the point — the count is not a property of the page.
 */
const mount = async (searchQuery: string): Promise<DomHarness> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [] };
		if (call.path.endsWith("/threads/search")) {
			const url = new URL(call.url, "http://localhost");
			if (url.searchParams.get("count") === "true") {
				return { items: [], count: TOTAL_MATCHES };
			}
			return { items: page, continuationToken: "next" };
		}
		return { items: [] };
	});

	const router = testRouter(searchQuery);
	await router.load();
	const mounted = createDomHarness();
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	// The page and the count are two requests in flight at once; both have to
	// land before the header is what it will settle on.
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
	return mounted;
};

/** Requests that asked the server to count, in order. */
const countRequests = (): number =>
	(http?.to("/threads/search") ?? []).filter(
		(call) =>
			new URL(call.url, "http://localhost").searchParams.get("count") ===
			"true",
	).length;

describe("the search result header (#307)", () => {
	it("states the whole match set while one page is loaded", async () => {
		const mounted = await mount("invoice");

		assert.match(
			mounted.text(),
			new RegExp(`${(TOTAL_MATCHES).toLocaleString()} results for`),
			"the header showed something other than the server's count",
		);
		assert.doesNotMatch(
			mounted.text(),
			new RegExp(`${PAGE_SIZE} results for`),
			"the header rendered the loaded page as the total",
		);
	});

	it("asks for the count once, not once per page", async () => {
		await mount("invoice");

		assert.equal(countRequests(), 1);
	});

	it("does not count a query that is still being typed", async () => {
		const mounted = await mount("in");

		assert.equal(
			countRequests(),
			0,
			"a two-character query paid for a count it would throw away",
		);
		assert.match(mounted.text(), /Results for/);
		assert.doesNotMatch(
			mounted.text(),
			/\d+ results? for/,
			"an uncounted search still showed a number",
		);
	});
});
