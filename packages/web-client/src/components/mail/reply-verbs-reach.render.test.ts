/**
 * Reply, Reply All and Forward answer the thread the address names (#803).
 *
 * The thread and the turn being answered are both path segments, so the verbs
 * have everything they need the moment the address is read. They used to wait
 * for the listing row instead — a reload or a bookmarked thread left all three
 * pressable and silent for a full round trip, and for good when the request
 * failed.
 *
 * The toolbar is mounted the way the route mounts it: the brief's provider over
 * the address, with the reading pane below it. Each case is what one address
 * does with the thread request unresolved, so nothing here can pass on a row
 * that arrived.
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
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { useOpenThreadPath } from "@/routing";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeAccount } from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { BriefPane } from "./BriefPane";
import { MessageToolbar } from "./MessageToolbar";

const ACCOUNT_ID = "acc-1";
const THREAD_ID = "thread-1";
const MESSAGE_ID = "msg-1";
const MESSAGE_PATH = `/mail/brief/${THREAD_ID}/${MESSAGE_ID}`;

const account = makeAccount({ accountId: ACCOUNT_ID });

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
 * The brief's real shape: the list is a layout route, the thread and the
 * message are the segments under it, and the mode is the segment under those.
 */
const testRouter = (href: string): AnyRouter => {
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
	const briefRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "/brief",
		component: BriefLayout,
	});
	const threadRoute = createRoute({
		getParentRoute: () => briefRoute,
		path: "$threadId",
		component: Outlet,
	});
	const messageRoute = createRoute({
		getParentRoute: () => threadRoute,
		path: "$messageId",
		component: () => createElement(BriefPane.Reading),
	});
	const replyRoute = createRoute({
		getParentRoute: () => messageRoute,
		path: "$mode/{-$outboxMessageId}",
	});
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([
			mailboxRoute,
			briefRoute.addChildren([
				threadRoute.addChildren([messageRoute.addChildren([replyRoute])]),
			]),
		]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [href] }),
	}) as unknown as AnyRouter;
};

/** How `routes/mail/brief.tsx` mounts it: the provider over the reading slot. */
function BriefLayout() {
	return createElement(BriefPane, {
		thread: useOpenThreadPath(),
		// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
		children: createElement(Outlet),
	});
}

type ThreadRequest = "hangs" | "fails";

const mountAt = async (
	href: string,
	threadRequest: ThreadRequest,
): Promise<[DomHarness, AnyRouter]> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			// A request in flight, and one that came back with nothing — the two
			// states in which no row exists to reply from.
			if (threadRequest === "fails") {
				return new Response("upstream unavailable", { status: 502 });
			}
			return new Promise(() => undefined);
		}
		return { items: [] };
	});

	const router = testRouter(href);
	await router.load();
	harness = createDomHarness();
	harness.renderApp(createElement(RouterProvider, { router }));
	await harness.flush();
	await harness.wait(20);
	await harness.flush();
	return [harness, router];
};

const press = async (mounted: DomHarness, label: string): Promise<void> => {
	mounted.click(mounted.byLabel(label));
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
};

describe("the reply verbs answer the thread the address names (#803)", () => {
	const cases: Array<[label: string, segment: string]> = [
		["Reply", "reply"],
		["Reply all", "reply-all"],
		["Forward", "forward"],
	];

	for (const [label, segment] of cases) {
		it(`${label} opens its mode while the thread request is still in flight`, async () => {
			const [mounted, router] = await mountAt(MESSAGE_PATH, "hangs");

			await press(mounted, label);

			assert.equal(
				router.state.location.pathname,
				`${MESSAGE_PATH}/${segment}`,
				`${label} answered the message in the address rather than waiting for a row`,
			);
		});
	}

	// The failure case is permanent: no row is ever coming, so a verb that waits
	// for one is dead for as long as the reader stays on the address.
	it("answers a message whose thread request came back an error", async () => {
		const [mounted, router] = await mountAt(MESSAGE_PATH, "fails");

		await press(mounted, "Reply");

		assert.equal(router.state.location.pathname, `${MESSAGE_PATH}/reply`);
	});

	it("says the conversation never arrived where the composer would be", async () => {
		const [mounted] = await mountAt(`${MESSAGE_PATH}/reply`, "fails");

		assert.match(
			mounted.text(),
			/nothing to answer/,
			"the reply address over a failed conversation explains itself rather than repeating the read error",
		);
	});
});

/**
 * The backstop for the one thing the address can be silent about: a bare thread
 * address leaves which turn answers to the thread itself. The shared toolbar
 * only explains a press when there is no thread at all, so an unwired verb
 * under an open one has to be answered here.
 */
describe("no toolbar verb is pressable and silent (#803)", () => {
	const mountToolbar = (): DomHarness => {
		const mounted = createDomHarness();
		harness = mounted;
		mounted.renderApp(
			createElement(MessageToolbar, {
				hasThread: true,
				intelligenceOpen: false,
				canToggleIntelligence: false,
				onToggleIntelligence: () => undefined,
			}),
		);
		return mounted;
	};

	for (const label of ["Reply", "Reply all", "Forward"]) {
		it(`${label} explains itself with a thread open and no handler wired`, async () => {
			const mounted = mountToolbar();

			mounted.click(mounted.byLabel(label));
			await mounted.flush();

			const status = mounted.query('[role="status"]');
			assert.ok(
				status,
				`${label} said nothing at all — a press must never be swallowed`,
			);
			assert.match(status.textContent ?? "", /hasn't loaded yet/);
		});
	}
});
