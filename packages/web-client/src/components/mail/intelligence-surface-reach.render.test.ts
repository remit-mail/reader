/**
 * Every list pane reaches intelligence at every width its reading pane mounts
 * (#817).
 *
 * The shell mounts the reading pane from 1024px and the intelligence rail only
 * from 1280px. The brief and Flagged read the rail's gate as the answer for
 * both, so between the two the toolbar's control rendered greyed out with no
 * drawer behind it, and the authenticity banner's "Why?" was never wired at
 * all — the DKIM explanation was unreachable on the brief at every desktop
 * width. Only the mailbox was ever fixed (#744), which is what left three
 * copies of one rule to drift apart.
 *
 * Mounted in the real `AppShellSlotted`, seeded at 1100px: which panes this
 * width has is the shell's own answer here, not a stub's.
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
import { type ComponentType, createElement, type ReactNode } from "react";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { type OpenThreadPath, useOpenThreadPath } from "@/routing";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeThreadMessage } from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import {
	describedMessage,
	intelligenceDrawer,
	MESSAGE_ID,
	settle,
	THREAD_ID,
} from "@/test-support/intelligence-surface";
import { BriefPane } from "./BriefPane";
import { FlaggedPane } from "./FlaggedPane";

/** Below the rail's 1280px gate, above the reading pane's 1024px one. */
const TWO_PANE_WIDTH = 1100;

const SHOW_INTELLIGENCE = "Show intelligence sidebar";
const HIDE_INTELLIGENCE = "Hide intelligence sidebar";

/** The one row shape that carries a warning: DKIM signed by another domain. */
const row = makeThreadMessage({
	messageId: MESSAGE_ID,
	threadId: THREAD_ID,
	subject: "Your parcel could not be delivered",
	fromName: "Mondial Relay",
	fromEmail: "delivery.notice@gmail.example",
	hasStars: true,
	star: "yellow",
	authenticity: {
		dkimMismatch: true,
		fromDomain: "mondialrelay.fr",
		dkimDomain: "gmail.example",
	},
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

interface PaneUnderTest {
	name: string;
	/** The list's own segment under `/mail`, which is its whole route. */
	segment: string;
	Provider: ComponentType<{
		thread: OpenThreadPath | undefined;
		children: ReactNode;
	}>;
	Reading: ComponentType;
}

const panes: PaneUnderTest[] = [
	{
		name: "the brief",
		segment: "brief",
		Provider: BriefPane,
		Reading: BriefPane.Reading,
	},
	{
		name: "Flagged",
		segment: "flagged",
		Provider: FlaggedPane,
		Reading: FlaggedPane.Reading,
	},
];

const testRouter = (pane: PaneUnderTest): AnyRouter => {
	const rootRoute = createRootRoute({
		component: () =>
			createElement(ComposeProvider, null, createElement(Outlet)),
	});
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		validateSearch: (search: Record<string, unknown>) => search,
		component: Outlet,
	});
	// Present so `useBrowsedList` has the route its `from` names, the way the
	// generated tree does.
	const mailboxRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/$mailboxId",
		component: Outlet,
	});
	const listRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: `/${pane.segment}`,
		component: () =>
			createElement(pane.Provider, {
				thread: useOpenThreadPath(),
				// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
				children: createElement(Outlet),
			}),
	});
	const threadRoute = createRoute({
		getParentRoute: () => listRoute,
		path: "$threadId",
		component: Outlet,
	});
	// The shell the route mounts, seeded at a width with no room for the rail.
	const messageRoute = createRoute({
		getParentRoute: () => threadRoute,
		path: "$messageId",
		component: () =>
			createElement(AppShellSlotted, {
				initialWidth: TWO_PANE_WIDTH,
				nav: null,
				list: null,
				reading: createElement(pane.Reading),
			}),
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([
			mailboxRoute,
			listRoute.addChildren([threadRoute.addChildren([messageRoute])]),
		]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({
			initialEntries: [`/mail/${pane.segment}/${THREAD_ID}/${MESSAGE_ID}`],
		}),
	}) as unknown as AnyRouter;
};

const mount = async (pane: PaneUnderTest): Promise<DomHarness> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: [row] };
		}
		if (call.path.includes("/messages/")) return describedMessage;
		if (call.path.includes("/threads")) return { items: [row] };
		return { items: [] };
	});

	const router = testRouter(pane);
	await router.load();
	const mounted = createDomHarness({ viewportWidth: TWO_PANE_WIDTH });
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await settle(mounted);
	return mounted;
};

describe("intelligence is reachable wherever the reading pane mounts (#817)", () => {
	for (const pane of panes) {
		it(`${pane.name} offers a live toolbar control below the rail's width`, async () => {
			const mounted = await mount(pane);

			const toggle = mounted.byLabel(SHOW_INTELLIGENCE) as HTMLButtonElement;
			assert.equal(
				toggle.disabled,
				false,
				"the control was greyed out at a width where the drawer is the surface",
			);

			mounted.click(toggle);
			await settle(mounted);

			assert.ok(intelligenceDrawer(mounted), "pressing it opened nothing");
			assert.ok(
				mounted.query(`[aria-label="${HIDE_INTELLIGENCE}"]`),
				"the toolbar still reports the surface as closed",
			);
		});

		it(`${pane.name} reaches the DKIM explanation from the banner`, async () => {
			const mounted = await mount(pane);

			mounted.click(mounted.byText("button", "Why?"));
			await settle(mounted);

			assert.ok(
				intelligenceDrawer(mounted),
				"the banner's Why? reached no intelligence surface",
			);
		});
	}
});
