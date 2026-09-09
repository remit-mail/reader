/**
 * A list narrowed by anything at all says so when it comes back empty (#1126).
 *
 * Both list panes built the empty state's filter from the category chip alone,
 * and `MessageListEmpty` reads that object's presence as "a filter is active".
 * So the Unread chip on its own — or `is:unread` typed in the field — fell
 * through to the unfiltered copy: "No messages in Starred" over a collection
 * holding thousands of starred messages, with no way out offered.
 *
 * Driven through the chips the reader actually presses, in the real panes, so
 * the assertion is about what the screen says rather than what a helper returns.
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
import { type ComponentType, createElement, type ReactNode } from "react";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { MailContext, type MailContextValue } from "@/lib/mail-context";
import { MailFreshnessProvider } from "@/lib/mail-freshness";
import { EMPTY_RESULT_FOLDER_INDEX } from "@/lib/result-folder";
import { useOpenThreadPath } from "@/routing";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { FlaggedPane } from "./FlaggedPane";
import { MailboxPane } from "./MailboxPane";

const MAILBOX_ID = "11111111-1111-4111-8111-111111111111";
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

interface PaneUnderTest {
	name: string;
	/** The list's own segment under `/mail`, which is its whole route. */
	segment: string;
	/** What the empty state calls the collection. */
	scopeLabel: string;
	List: ComponentType;
	mount: (children: ReactNode) => ReactNode;
}

const panes: PaneUnderTest[] = [
	{
		name: "Starred",
		segment: "flagged",
		scopeLabel: "Starred",
		List: FlaggedPane.List,
		mount: (children) =>
			createElement(FlaggedPane, {
				thread: useOpenThreadPath(),
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
				children,
			}),
	},
	{
		name: "the mailbox",
		segment: MAILBOX_ID,
		scopeLabel: "Inbox",
		List: MailboxPane.List,
		mount: (children) =>
			createElement(MailboxPane, {
				mailboxId: MAILBOX_ID,
				thread: useOpenThreadPath(),
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
				children,
			}),
	},
];

/** The layout context the panes read the search field out of. */
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

const testRouter = (pane: PaneUnderTest, query: string): AnyRouter => {
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
	const mailboxRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/$mailboxId",
		component: () => pane.mount(createElement(pane.List)),
	});
	const flaggedRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/flagged",
		component: () => pane.mount(createElement(pane.List)),
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([mailboxRoute, flaggedRoute]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({
			initialEntries: [`/mail/${pane.segment}`],
		}),
	}) as unknown as AnyRouter;
};

const mount = async (pane: PaneUnderTest, query = ""): Promise<DomHarness> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [] };
		if (call.path.endsWith("/mailboxes")) {
			return {
				items: [{ mailboxId: MAILBOX_ID, name: "Inbox", fullPath: "INBOX" }],
			};
		}
		return { items: [] };
	});

	const router = testRouter(pane, query);
	await router.load();
	const mounted = createDomHarness({ viewportWidth: DESKTOP_WIDTH });
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await mounted.waitFor(
		() => mounted.text().includes("No "),
		"the empty list to settle",
	);
	return mounted;
};

/** Press the Unread chip, which is the whole narrowing this test is about. */
const pressUnread = async (mounted: DomHarness): Promise<void> => {
	mounted.click(mounted.byLabel("Expand filters"));
	await mounted.flush();
	const attributes = mounted.query('fieldset[aria-label="Attributes"]');
	assert.ok(attributes, "the attribute chips are not on screen");
	const unread = [...attributes.querySelectorAll("button")].find(
		(button) => button.textContent === "Unread",
	);
	assert.ok(unread, "there is no Unread chip to press");
	mounted.click(unread);
	await mounted.waitFor(
		() => mounted.text().includes("No "),
		"the narrowed list to answer",
	);
};

describe("an empty list narrowed by a chip or a token (#1126)", () => {
	for (const pane of panes) {
		it(`${pane.name} names the narrowing instead of the collection`, async () => {
			const mounted = await mount(pane);
			assert.match(
				mounted.text(),
				new RegExp(`No messages in ${pane.scopeLabel}`),
				"the unfiltered copy is the state this test starts from",
			);

			await pressUnread(mounted);

			const shown = mounted.text();
			assert.match(shown, new RegExp(`No unread mail in ${pane.scopeLabel}`));
			assert.doesNotMatch(
				shown,
				new RegExp(`No messages in ${pane.scopeLabel}`),
				"a filtered list told the reader the collection itself was empty",
			);
		});

		it(`${pane.name} answers a token-only search the same way`, async () => {
			const mounted = await mount(pane, "is:unread");

			const shown = mounted.text();
			assert.match(shown, new RegExp(`No unread mail in ${pane.scopeLabel}`));
			assert.doesNotMatch(
				shown,
				new RegExp(`No messages in ${pane.scopeLabel}`),
				"a search of tokens alone read as an empty collection",
			);
			assert.doesNotMatch(
				shown,
				/No messages match your search/,
				"the narrowing is named, so the generic search line is wrong here",
			);
		});

		it(`${pane.name} says how much was checked and offers the way out`, async () => {
			const mounted = await mount(pane);
			await pressUnread(mounted);

			const shown = mounted.text();
			assert.match(shown, /Every message in this folder was checked\./);
			assert.ok(
				[...mounted.queryAll("button")].some(
					(button) => button.textContent === "Clear filter",
				),
				"a narrowed empty list offered no way back out of the narrowing",
			);
		});
	}
});
