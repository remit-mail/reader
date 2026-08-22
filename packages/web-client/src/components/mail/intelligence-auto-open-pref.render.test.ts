/**
 * A DKIM mismatch raises the rail without rewriting the stored preference
 * (#778).
 *
 * The auto-open reached for the reader's own toggle, so one message signed by
 * the wrong domain wrote `remit:intelligence-open` to `open` — for every later
 * thread and every later session, including for a reader who had collapsed the
 * rail on purpose. The rail's two verbs are bound here through the real
 * `useRailPanels`, so the preference this asserts on is the one the shell
 * actually writes.
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
import { EMPTY_RESULT_FOLDER_INDEX } from "@/lib/result-folder";
import { useOpenThreadPath } from "@/routing";
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
	return createElement(MailContext.Provider, { value }, children);
}

function Shell() {
	const { intelligenceOpen } = useMailContext();
	return createElement(AppShellSlotted, {
		initialWidth: RAIL_WIDTH,
		nav: null,
		list: null,
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
		if (call.path.includes("/messages/")) return describedMessage;
		if (call.path.includes("/threads")) return { items: [row] };
		return { items: [] };
	});

	const router = testRouter();
	await router.load();
	const mounted = createDomHarness({ viewportWidth: RAIL_WIDTH });
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	// Twice: the auto-open navigates from an effect the first settle runs.
	await settle(mounted);
	await settle(mounted);
	return [mounted, router];
};

describe("the DKIM auto-open and the stored rail preference (#778)", () => {
	// The address is what puts the rail up over a collapse, and `resolveRailOpen`
	// is where the two meet; this asks what the mismatch wrote, and what it left
	// alone.
	it("raises the rail for the message it fired on", async () => {
		const store = installStorage("closed");

		const [, router] = await mount();

		assert.equal(
			router.state.location.hash,
			"intelligence",
			"the mismatch left the rail down",
		);
		assert.equal(
			store.get(INTELLIGENCE_PREF_KEY),
			"closed",
			"one mismatch rewrote the preference the reader chose",
		);
	});

	it("still stores the rail the reader put away themselves", async () => {
		const store = installStorage();

		const [mounted] = await mount();
		mounted.click(mounted.byLabel(HIDE_INTELLIGENCE));
		await settle(mounted);

		assert.ok(
			mounted.query(`[aria-label="${SHOW_INTELLIGENCE}"]`),
			"the reader's own toggle left the rail up",
		);
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

		assert.equal(
			store.get(INTELLIGENCE_PREF_KEY),
			"open",
			"the reader's own toggle stopped storing what they chose",
		);
	});
});
