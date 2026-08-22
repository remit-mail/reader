/**
 * A DKIM mismatch raises the rail for the message it fired on, and for nothing
 * else (#778).
 *
 * The auto-open reached for the reader's own toggle, so one message signed by
 * the wrong domain wrote `remit:intelligence-open` to `open` and kept the rail
 * up for every later thread and every later session, including for a reader who
 * had collapsed the rail on purpose. The rail's two verbs are bound here through
 * the real `useRailPanels`. That a raise ends with the message it was made for
 * is proved in `lib/intelligence-pref.test.ts`: this environment never
 * re-renders a mounted component when the router's own state moves, so what a
 * navigation carries is only observable here through the reader's own answer.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AppShellSlotted } from "@remit/ui";
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
import { useRailPanels } from "@/hooks/useRailPanels";
import { INTELLIGENCE_PREF_KEY } from "@/lib/intelligence-pref";
import {
	MailContext,
	type MailContextValue,
	useMailContext,
} from "@/lib/mail-context";
import { MailFreshnessProvider } from "@/lib/mail-freshness";
import { EMPTY_RESULT_FOLDER_INDEX } from "@/lib/result-folder";
import { retainOpenPanelsAtTier, useOpenThreadPath } from "@/routing";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeThreadMessage } from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import {
	describedMessage,
	MESSAGE_ID,
	settle,
	THREAD_ID,
} from "@/test-support/intelligence-surface";
import { MailboxPane } from "./MailboxPane";

/** Wide enough for the rail, which is the surface the auto-open acts on. */
const RAIL_WIDTH = 1400;

const MAILBOX_ID = "mailbox-1";
const MESSAGE_PATH = `/mail/${MAILBOX_ID}/${THREAD_ID}/${MESSAGE_ID}`;

const NEXT_THREAD_ID = "thread-2";
const NEXT_MESSAGE_ID = "msg-2";

const SHOW_INTELLIGENCE = "Show intelligence sidebar";
const HIDE_INTELLIGENCE = "Hide intelligence sidebar";

/** Signed by another domain: what the reading pane's auto-open fires on. */
const row = makeThreadMessage({
	messageId: MESSAGE_ID,
	threadId: THREAD_ID,
	subject: "Your parcel could not be delivered",
	fromName: "Mondial Relay",
	fromEmail: "delivery.notice@gmail.example",
	authenticity: {
		dkimMismatch: true,
		fromDomain: "mondialrelay.fr",
		dkimDomain: "gmail.example",
	},
});

/** The next thread the reader opens, which raised nothing of its own. */
const nextRow = makeThreadMessage({
	messageId: NEXT_MESSAGE_ID,
	threadId: NEXT_THREAD_ID,
	subject: "Lunch on Thursday",
	fromName: "Ada",
	fromEmail: "ada@mondialrelay.fr",
});

/** jsdom's own storage is not on `globalThis`, which is where the pref reads. */
const installStorage = (seed?: string): Map<string, string> => {
	const store = new Map<string, string>();
	if (seed !== undefined) store.set(INTELLIGENCE_PREF_KEY, seed);
	(globalThis as { localStorage?: Storage }).localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
	} as Storage;
	return store;
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	(globalThis as { localStorage?: Storage }).localStorage = undefined;
});

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

/** The `/mail` layout's own binding, from the hook the layout uses. */
function MailLayout({ children }: { children: ReactNode }) {
	const { intelligenceOpen, toggleIntelligence, raiseIntelligence } =
		useRailPanels();
	const value: MailContextValue = {
		accounts: [],
		mailboxNameIndex: new Map(),
		accountNameIndex: new Map(),
		resultFolderIndex: EMPTY_RESULT_FOLDER_INDEX,
		searchQuery: "",
		searchInput: "",
		searchViewKey: "",
		onSearchChange: () => {},
		onSearchClear: () => {},
		onSearchClearQuery: () => {},
		intelligenceOpen,
		onToggleIntelligence: toggleIntelligence,
		onRaiseIntelligence: raiseIntelligence,
	};
	return createElement(
		MailContext.Provider,
		{ value },
		createElement(MailFreshnessProvider, {
			accountIds: [],
			// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
			children,
		}),
	);
}

function Shell() {
	const { intelligenceOpen } = useMailContext();
	return createElement(AppShellSlotted, {
		initialWidth: RAIL_WIDTH,
		nav: null,
		list: createElement(MailboxPane.List),
		reading: createElement(MailboxPane.Reading),
		intelligence: createElement(MailboxPane.Intelligence),
		intelligenceOpen,
	});
}

const testRouter = (): AnyRouter => {
	const rootRoute = createRootRoute({
		component: () =>
			createElement(
				ComposeProvider,
				null,
				createElement(MailLayout, {
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
				children: createElement(Outlet),
			}),
	});
	const threadRoute = createRoute({
		getParentRoute: () => mailboxRoute,
		path: "$threadId",
		component: Outlet,
	});
	const messageRoute = createRoute({
		getParentRoute: () => threadRoute,
		path: "$messageId",
		component: () => createElement(Shell),
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([
			mailboxRoute.addChildren([threadRoute.addChildren([messageRoute])]),
		]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [MESSAGE_PATH] }),
	}) as unknown as AnyRouter;
};

const mount = async (): Promise<[DomHarness, AnyRouter]> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: [row] };
		}
		if (call.path.endsWith(`/threads/${NEXT_THREAD_ID}/messages`)) {
			return { items: [nextRow] };
		}
		if (call.path.includes("/messages/")) return describedMessage;
		if (call.path.includes("/threads")) return { items: [row, nextRow] };
		return { items: [] };
	});

	const router = testRouter();
	await router.load();
	const mounted = createDomHarness({ viewportWidth: RAIL_WIDTH });
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	// Twice: the auto-open acts from an effect the first settle runs.
	await settle(mounted);
	await settle(mounted);
	return [mounted, router];
};

/**
 * Opening the next thread, as every list opens one: the thread route, with the
 * fragment run through the real retain updater the rows pass as `hash`
 * (`MessageList.openRow`). The rows themselves are virtualized, so jsdom has no
 * row to click.
 */
const openNextThread = async (
	mounted: DomHarness,
	router: AnyRouter,
): Promise<void> => {
	await router.navigate({
		to: "/mail/$mailboxId/$threadId/$messageId",
		params: {
			mailboxId: MAILBOX_ID,
			threadId: NEXT_THREAD_ID,
			messageId: NEXT_MESSAGE_ID,
		},
		hash: retainOpenPanelsAtTier(true),
	});
	await settle(mounted);
	await settle(mounted);
};

const railIsUp = (mounted: DomHarness): boolean =>
	mounted.query(`[aria-label="${HIDE_INTELLIGENCE}"]`) !== null;

describe("the DKIM auto-open and the stored rail preference (#778)", () => {
	it("raises the rail for the message it fired on", async () => {
		const store = installStorage("closed");

		const [mounted, router] = await mount();

		assert.equal(railIsUp(mounted), true, "the mismatch left the rail down");
		assert.equal(
			store.get(INTELLIGENCE_PREF_KEY),
			"closed",
			"one mismatch rewrote the preference the reader chose",
		);
		assert.equal(
			router.state.location.hash,
			"",
			"a raise for one message was written into the address",
		);
	});

	it("carries a rail the reader put up themselves to the next thread", async () => {
		installStorage("closed");

		const [mounted, router] = await mount();
		// Down from the raise, then up as the reader's own answer.
		mounted.click(mounted.byLabel(HIDE_INTELLIGENCE));
		await settle(mounted);
		mounted.click(mounted.byLabel(SHOW_INTELLIGENCE));
		await settle(mounted);

		await openNextThread(mounted, router);

		assert.equal(railIsUp(mounted), true, "the rail came down on its own");
		assert.equal(
			router.state.location.hash,
			"intelligence",
			"the reader's own rail stayed out of the address",
		);
	});

	it("still stores the rail the reader put away themselves", async () => {
		const store = installStorage();

		const [mounted] = await mount();
		mounted.click(mounted.byLabel(HIDE_INTELLIGENCE));
		await settle(mounted);

		assert.equal(railIsUp(mounted), false, "the toggle left the rail up");
		assert.equal(
			store.get(INTELLIGENCE_PREF_KEY),
			"closed",
			"the reader's own toggle stopped storing what they chose",
		);
	});

	it("still stores the rail the reader put up themselves", async () => {
		const store = installStorage();

		const [mounted] = await mount();
		mounted.click(mounted.byLabel(HIDE_INTELLIGENCE));
		await settle(mounted);
		mounted.click(mounted.byLabel(SHOW_INTELLIGENCE));
		await settle(mounted);

		assert.equal(railIsUp(mounted), true, "the toggle left the rail down");
		assert.equal(
			store.get(INTELLIGENCE_PREF_KEY),
			"open",
			"the reader's own toggle stopped storing what they chose",
		);
	});

	// "Why?" asks about the message on screen. It is the same raise the mismatch
	// makes, not a statement about where the reader wants the rail.
	it("the banner's Why opens the rail without storing a preference", async () => {
		const store = installStorage();

		const [mounted] = await mount();
		mounted.click(mounted.byLabel(HIDE_INTELLIGENCE));
		await settle(mounted);

		mounted.click(mounted.byText("button", "Why?"));
		await settle(mounted);

		assert.equal(railIsUp(mounted), true, "the banner's Why reached no rail");
		assert.equal(
			store.get(INTELLIGENCE_PREF_KEY),
			"closed",
			"a question about one message rewrote the stored preference",
		);
	});
});
