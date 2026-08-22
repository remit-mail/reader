/**
 * The mailbox's intelligence keys act on the surface the width has (#840).
 *
 * `i` and `b` are registered by the pane provider, which sits above the shell
 * and so cannot see the rail's own width gate. Both reached for the rail's
 * toggle directly, and below 1280 that wrote `#intelligence` into the address
 * with no rail mounted to render it — a panel the address names and nothing
 * answers (`docs/architecture/url-state.md`, R6). The drawer is the surface at
 * those widths, and it is what the toolbar's own control already used.
 *
 * Mounted in the real `AppShellSlotted` at all three tiers, with the `/mail`
 * layout's binding between the fragment and the rail: which panes a width has
 * is the shell's own answer here, and what the address holds is the router's.
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
import { createElement, type ReactNode, useCallback, useState } from "react";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import {
	MailContext,
	type MailContextValue,
	useMailContext,
} from "@/lib/mail-context";
import { EMPTY_RESULT_FOLDER_INDEX } from "@/lib/result-folder";
import {
	isOverlayPanel,
	useOpenPanels,
	useOpenThreadPath,
	useSetOpenPanels,
} from "@/routing";
import {
	createDomHarness,
	type DomHarness,
	type DomOptions,
} from "@/test-support/dom";
import { makeThreadMessage } from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import {
	describedMessage,
	intelligenceDrawer,
	MESSAGE_ID,
	settle,
	THREAD_ID,
} from "@/test-support/intelligence-surface";
import { MailboxPane } from "./MailboxPane";

/** Below the rail's 1280px gate, above the reading pane's 1024px one. */
const TWO_PANE_WIDTH = 1100;
/** Wide enough for the rail, which is where the fragment raises it. */
const RAIL_WIDTH = 1400;
/** One pane, where the list route mounts its phone view instead of the slots. */
const PHONE_WIDTH = 420;

const MAILBOX_ID = "mailbox-1";
const MESSAGE_PATH = `/mail/${MAILBOX_ID}/${THREAD_ID}/${MESSAGE_ID}`;

/**
 * No DKIM mismatch: the auto-open raises the rail on its own where the rail
 * fits, which would put `#intelligence` in the address before any key is
 * pressed.
 */
const row = makeThreadMessage({
	messageId: MESSAGE_ID,
	threadId: THREAD_ID,
	subject: "Your parcel could not be delivered",
	fromName: "Mondial Relay",
	fromEmail: "delivery.notice@gmail.example",
});

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

/**
 * What `routes/mail.tsx` binds: the rail's open state is the fragment, and the
 * toggle rewrites the fragment. The device preference is left out — nothing
 * here is about the tier the address is silent on.
 */
function MailLayout({ children }: { children: ReactNode }) {
	const openPanels = useOpenPanels();
	const setOpenPanels = useSetOpenPanels();
	// A raise is held in memory against the open message, the way the layout
	// holds it; the address carries the reader's own answer alone.
	const [raised, setRaised] = useState(false);
	const intelligenceOpen = openPanels.includes("intelligence") || raised;
	// The overlays travel through the write, the way the layout composes the
	// whole set: a sheet up over the rail is not closed by the rail moving.
	const overlays = openPanels.filter(isOverlayPanel);
	const onToggleIntelligence = useCallback(() => {
		setRaised(false);
		setOpenPanels(
			intelligenceOpen ? overlays : ["intelligence" as const, ...overlays],
		);
	}, [intelligenceOpen, overlays, setOpenPanels]);
	const onRaiseIntelligence = useCallback(() => {
		setRaised(true);
	}, []);

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
		onToggleIntelligence,
		onRaiseIntelligence,
	};
	return createElement(MailContext.Provider, { value }, children);
}

/**
 * The shell as `MailShell` mounts it: one pane carrying the phone view below
 * the reading boundary, the slots above it, and the rail's visibility taken
 * from the layout's own answer, which is the shell's only source for it.
 */
function Shell({ width }: { width: number }) {
	const { intelligenceOpen } = useMailContext();
	if (width < 1024) {
		return createElement(AppShellSlotted, {
			initialWidth: width,
			nav: null,
			list: createElement(MailboxPane.Phone),
		});
	}
	return createElement(AppShellSlotted, {
		initialWidth: width,
		nav: null,
		list: null,
		reading: createElement(MailboxPane.Reading),
		intelligence: createElement(MailboxPane.Intelligence),
		intelligenceOpen,
	});
}

const testRouter = (width: number, href: string): AnyRouter => {
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
		component: () => createElement(Shell, { width }),
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([
			mailboxRoute.addChildren([threadRoute.addChildren([messageRoute])]),
		]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [href] }),
	}) as unknown as AnyRouter;
};

const mountAt = async (
	width: number,
	options: DomOptions = {},
	href: string = MESSAGE_PATH,
): Promise<[DomHarness, AnyRouter]> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: [row] };
		}
		if (call.path.includes("/messages/")) return describedMessage;
		if (call.path.includes("/threads")) return { items: [row] };
		return { items: [] };
	});

	const router = testRouter(width, href);
	await router.load();
	const mounted = createDomHarness({ viewportWidth: width, ...options });
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await settle(mounted);
	return [mounted, router];
};

const press = async (mounted: DomHarness, key: string): Promise<void> => {
	mounted.dispatch(
		mounted.window,
		new mounted.window.KeyboardEvent("keydown", { key, bubbles: true }),
	);
	await settle(mounted);
};

/**
 * The rail: the intelligence panel mounted in the shell's own row rather than
 * inside the drawer, which puts the same panel behind a scrim.
 */
const rail = (mounted: DomHarness): HTMLElement | null => {
	const pane = mounted.query("aside");
	if (!pane) return null;
	return pane.closest('[role="dialog"]') ? null : pane;
};

describe("the intelligence keys reach the surface the width has (#840)", () => {
	for (const [tier, width, options] of [
		["between the reading pane and the rail", TWO_PANE_WIDTH, {}],
		[
			"on the phone",
			PHONE_WIDTH,
			{ pointer: "coarse", orientation: "portrait" } as DomOptions,
		],
	] as const) {
		it(`${tier}, i opens the drawer and leaves the address alone`, async () => {
			const [mounted, router] = await mountAt(width, options);

			await press(mounted, "i");

			assert.ok(intelligenceDrawer(mounted), "pressing i opened nothing");
			assert.equal(
				router.state.location.hash,
				"",
				"the address named a panel this width cannot render",
			);
		});

		it(`${tier}, a second i puts the drawer away`, async () => {
			const [mounted] = await mountAt(width, options);

			await press(mounted, "i");
			assert.ok(intelligenceDrawer(mounted), "pressing i opened nothing");

			await press(mounted, "i");
			assert.equal(
				intelligenceDrawer(mounted),
				null,
				"the second press left it up",
			);
		});

		it(`${tier}, b reaches block sender through the same drawer`, async () => {
			const [mounted, router] = await mountAt(width, options);

			await press(mounted, "b");

			assert.ok(intelligenceDrawer(mounted), "pressing b opened nothing");
			assert.equal(
				router.state.location.hash,
				"",
				"the address named a panel this width cannot render",
			);
		});
	}

	it("still writes the fragment where the rail is the surface", async () => {
		const [mounted, router] = await mountAt(RAIL_WIDTH);

		await press(mounted, "i");

		assert.equal(
			router.state.location.hash,
			"intelligence",
			"the rail's own tier stopped writing the fragment",
		);
		assert.equal(
			intelligenceDrawer(mounted),
			null,
			"the drawer came up where the rail is the surface",
		);
	});

	// Block sender asks about the message on screen, so it raises the rail for
	// that message and leaves the address alone (#778) — the surface it must
	// reach is still the rail, which is what this width has.
	it("raises the rail for block sender where the rail is the surface", async () => {
		const [mounted, router] = await mountAt(RAIL_WIDTH);

		await press(mounted, "b");

		assert.ok(rail(mounted), "block sender reached no rail");
		assert.equal(
			intelligenceDrawer(mounted),
			null,
			"the drawer came up where the rail is the surface",
		);
		assert.equal(
			router.state.location.hash,
			"",
			"a raise for one message was written into the address",
		);
	});
});

/**
 * What the fragment is worth at each width, on a cold load. The rail is the one
 * renderer the name has, which is why the keys above must not write the name
 * anywhere else.
 */
describe("#intelligence names a renderer only where the rail fits", () => {
	it("mounts the rail where the address carries it and the width has room", async () => {
		const [mounted] = await mountAt(
			RAIL_WIDTH,
			{},
			`${MESSAGE_PATH}#intelligence`,
		);

		assert.ok(rail(mounted), "the fragment raised no rail");
	});

	it("mounts nothing for the same address below the rail's width", async () => {
		const [mounted] = await mountAt(
			TWO_PANE_WIDTH,
			{},
			`${MESSAGE_PATH}#intelligence`,
		);

		assert.equal(rail(mounted), null, "a rail rendered where none fits");
		assert.equal(
			intelligenceDrawer(mounted),
			null,
			"the fragment raised the drawer, which belongs to the thread",
		);
	});
});
