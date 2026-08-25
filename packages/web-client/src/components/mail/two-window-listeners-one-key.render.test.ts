/**
 * With a thread open, one press must move one cursor and answer one message
 * (#723).
 *
 * `useTriageLayer` (the pane's list cursor) and `ConversationView` (the open
 * conversation's own message cursor) each bind their own keydown listener on
 * `window`. Both used to act on the same press, so opening a thread and
 * pressing `j` once walked the list underneath it and the conversation on top
 * of it at the same time. `hasOpenThread` is what makes `useTriageLayer` drop
 * the keys the conversation already owns instead of racing it for them.
 *
 * The first half stands the list in with a stub `MessageListCommands` — the
 * same seam `MailboxPane` wires the real list through (`listCommandsRef`), so
 * every key the list would have served is recorded rather than inferred,
 * without the real list's virtualization along for the ride. The second half
 * gives up that reading to mount a real pane instead, because what each pane
 * actually passes for `hasOpenThread` is the other half of the handover.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapDescribeMessageResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { createElement, useEffect } from "react";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { useTriageContext, useTriageLayer } from "@/hooks/useTriageLayer";
import { MailFreshnessProvider } from "@/lib/mail-freshness";
import { useOpenThreadPath } from "@/routing";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeAccount, makeThreadMessage } from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { BriefPane } from "./BriefPane";
import { ConversationView } from "./ConversationView";
import type { MessageListCommands } from "./MessageList";

const ACCOUNT_ID = "acc-1";
const THREAD_ID = "thread-1";
const MAILBOX_ID = "mbx-inbox";
const MESSAGE_ID = "msg-1";
const OTHER_MESSAGE_ID = "msg-other";

const account = makeAccount({ accountId: ACCOUNT_ID });

const OPENING_SENT = 1_767_139_200_000;
const LATEST_SENT = 1_767_225_600_000;

const openingMessage: RemitImapThreadMessageResponse = makeThreadMessage({
	messageId: "msg-0",
	threadId: THREAD_ID,
	mailboxId: MAILBOX_ID,
	accountId: ACCOUNT_ID,
	subject: "Lunch Thursday?",
	fromName: "Grace Hopper",
	fromEmail: "grace@example.com",
	sentDate: OPENING_SENT,
	isRead: true,
});

const threadMessage: RemitImapThreadMessageResponse = makeThreadMessage({
	messageId: MESSAGE_ID,
	threadId: THREAD_ID,
	mailboxId: MAILBOX_ID,
	accountId: ACCOUNT_ID,
	subject: "Lunch Thursday?",
	fromName: "Ada Lovelace",
	fromEmail: "ada@example.com",
	sentDate: LATEST_SENT,
	isRead: true,
});

const describeMessage: RemitImapDescribeMessageResponse = {
	message: {
		messageId: MESSAGE_ID,
		mailboxId: MAILBOX_ID,
		uid: 1,
		rfc822Size: 512,
		internalDate: LATEST_SENT,
	},
	envelope: {
		messageId: MESSAGE_ID,
		date: LATEST_SENT,
		subject: "Lunch Thursday?",
		messageIdValue: "<ada-1@example.com>",
		from: [
			{
				addressId: "addr-ada",
				displayName: "Ada Lovelace",
				normalizedEmail: "ada@example.com",
				addressRole: "from",
				addressOrder: 0,
			},
		],
		to: [
			{
				addressId: "addr-me",
				normalizedEmail: "alice@example.com",
				addressRole: "to",
				addressOrder: 0,
			},
		],
		cc: [],
		bcc: [],
		replyTo: [],
		category: "uncategorized",
		senderTrust: "unknown",
	},
	flags: ["\\Seen"],
	bodyParts: [],
	references: [],
};

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

const LIST_PATH = `/mail/${MAILBOX_ID}`;
const MESSAGE_PATH = `${LIST_PATH}/${THREAD_ID}/${MESSAGE_ID}`;

const press = async (mounted: DomHarness, key: string): Promise<void> => {
	mounted.dispatch(
		mounted.window,
		new mounted.window.KeyboardEvent("keydown", { key, bubbles: true }),
	);
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
};

/**
 * The pane's own wiring, the way `MailboxPane` binds it to the real list: the
 * layer over a stub list, with the conversation mounted above it exactly while
 * a thread is open. Every list action and every pane verb the stub is asked for
 * is recorded, so a press that reaches the list as well as the conversation
 * shows up here.
 */
function PaneShell({
	hasOpenThread,
	onListAction,
}: {
	hasOpenThread: boolean;
	onListAction: (action: string) => void;
}) {
	const triage = useTriageContext();

	// biome-ignore lint/correctness/useExhaustiveDependencies: registered once, the way a mounted list reports itself once — the stub never changes shape across the test.
	useEffect(() => {
		const commands: MessageListCommands = {
			focusNext: () => onListAction("focusNext"),
			focusPrevious: () => onListAction("focusPrevious"),
			focusFirst: () => onListAction("focusFirst"),
			focusLast: () => onListAction("focusLast"),
			openFocused: () => onListAction("openFocused"),
			toggleSelect: () => onListAction("toggleSelect"),
			extendSelectDown: () => onListAction("extendSelectDown"),
			extendSelectUp: () => onListAction("extendSelectUp"),
			selectAll: () => onListAction("selectAll"),
			clearSelection: () => false,
			requestVerb: () => false,
			toggleDensity: () => onListAction("toggleDensity"),
		};
		triage.listCommandsRef.current = commands;
		triage.onTriageContextChange({
			focusedMessageId: MESSAGE_ID,
			selectedIds: [],
			hasList: true,
			blocksKeyboard: false,
			orderedIds: [MESSAGE_ID, OTHER_MESSAGE_ID],
		});
	}, []);

	useTriageLayer({
		context: triage,
		orderedIds: [MESSAGE_ID, OTHER_MESSAGE_ID],
		selectedMessageId: MESSAGE_ID,
		hasOpenThread,
		onClose: () => undefined,
		handlers: {
			reply: () => onListAction("reply"),
			replyAll: () => onListAction("replyAll"),
			forward: () => onListAction("forward"),
		},
	});

	if (!hasOpenThread) return null;

	return createElement(ConversationView, {
		threadId: THREAD_ID,
		mailboxId: MAILBOX_ID,
		subject: "Lunch Thursday?",
		selectedMessageId: MESSAGE_ID,
	});
}

const testRouter = (
	href: string,
	onListAction: (action: string) => void,
): AnyRouter => {
	const rootRoute = createRootRoute({
		component: () =>
			createElement(ComposeProvider, null, createElement(Outlet)),
	});
	const mailboxRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail/$mailboxId",
		validateSearch: (search: Record<string, unknown>) => search,
	});
	const listRoute = createRoute({
		getParentRoute: () => mailboxRoute,
		path: "/",
		component: () =>
			createElement(PaneShell, { hasOpenThread: false, onListAction }),
	});
	const threadRoute = createRoute({
		getParentRoute: () => mailboxRoute,
		path: "$threadId",
	});
	const messageRoute = createRoute({
		getParentRoute: () => threadRoute,
		path: "$messageId",
		component: () =>
			createElement(PaneShell, { hasOpenThread: true, onListAction }),
	});
	const replyRoute = createRoute({
		getParentRoute: () => messageRoute,
		path: "$mode/{-$outboxMessageId}",
	});
	const routeTree = rootRoute.addChildren([
		mailboxRoute.addChildren([
			listRoute,
			threadRoute.addChildren([messageRoute.addChildren([replyRoute])]),
		]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [href] }),
	}) as unknown as AnyRouter;
};

const mount = async (
	href: string,
	onListAction: (action: string) => void,
): Promise<[DomHarness, AnyRouter]> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: [openingMessage, threadMessage] };
		}
		if (call.path.endsWith(`/messages/${MESSAGE_ID}`)) return describeMessage;
		return { items: [] };
	});

	const router = testRouter(href, onListAction);
	await router.load();
	const mounted = createDomHarness();
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
	return [mounted, router];
};

/** The inset ring `MessageCard` draws on the row the keyboard is sitting on. */
const FOCUS_RING = /ring-accent\//;

/** The turn the conversation's own cursor has, read off the ring it draws. */
const focusedTurn = (mounted: DomHarness): string => {
	const thread = mounted.query('[data-testid="conversation-messages"]');
	assert.ok(thread, "the thread is on screen");
	const focused = [...thread.children].filter((card) =>
		[...card.querySelectorAll("*")].some((node) =>
			FOCUS_RING.test(node.getAttribute("class") ?? ""),
		),
	);
	assert.equal(focused.length, 1, "one turn carries the conversation cursor");
	return focused[0]?.textContent ?? "";
};

describe("one press with a thread open (#723)", () => {
	it("j moves the conversation's cursor and leaves the pane's list cursor alone", async () => {
		const listActions: string[] = [];
		const [mounted] = await mount(MESSAGE_PATH, (action) =>
			listActions.push(action),
		);

		assert.ok(
			focusedTurn(mounted).includes("Ada Lovelace"),
			"the conversation cursor starts on the latest turn",
		);

		await press(mounted, "j");

		assert.ok(
			focusedTurn(mounted).includes("Grace Hopper"),
			"j moved the conversation's own cursor to the next turn",
		);
		assert.deepEqual(
			listActions,
			[],
			"the pane's list cursor took no action — the conversation is the sole owner of j while its thread is open",
		);
	});

	it("r answers the conversation rather than the row the pane is aimed at", async () => {
		const listActions: string[] = [];
		const [mounted, router] = await mount(MESSAGE_PATH, (action) =>
			listActions.push(action),
		);

		await press(mounted, "r");

		assert.equal(
			router.state.location.pathname,
			`${MESSAGE_PATH}/reply`,
			"r answered something other than the message on screen",
		);
		assert.deepEqual(
			listActions,
			[],
			"the pane answered as well, so one press opened two replies",
		);
	});

	// Home, End and `a` are the half of the handover the conversation has no
	// binding of its own for. Kept by the layer they act on the list under the
	// open thread, where End walks a cursor nobody can see and `a` answers a
	// different message than `r` just did.
	it("Home, End and a go nowhere rather than reaching the list underneath", async () => {
		const listActions: string[] = [];
		const [mounted, router] = await mount(MESSAGE_PATH, (action) =>
			listActions.push(action),
		);

		await press(mounted, "Home");
		await press(mounted, "End");
		await press(mounted, "a");

		assert.deepEqual(
			listActions,
			[],
			"a key the conversation owns while it is open still reached the list",
		);
		assert.equal(
			router.state.location.pathname,
			MESSAGE_PATH,
			"a press that must be inert moved the address",
		);
	});
});

describe("the same keys with no thread open (#723)", () => {
	it("hands j, End and a back to the list", async () => {
		const listActions: string[] = [];
		const [mounted] = await mount(LIST_PATH, (action) =>
			listActions.push(action),
		);

		await press(mounted, "j");
		await press(mounted, "End");
		await press(mounted, "a");

		assert.deepEqual(
			listActions,
			["focusNext", "focusLast", "replyAll"],
			"the layer kept the keys dropped after the conversation closed",
		);
	});
});

/**
 * The other half: what a pane passes for `hasOpenThread`. The brief is mounted
 * whole — its own list, its own reading pane, and the address as the only thing
 * that says whether a thread is open. `a` is what reads it, because the
 * conversation binds `R` for reply-all and never plain `a`: with the thread open
 * the key must reach nothing at all, and with it closed the same pane must
 * answer the row its cursor is on.
 */
const BRIEF_LIST_PATH = "/mail/brief";
const BRIEF_MESSAGE_PATH = `${BRIEF_LIST_PATH}/${THREAD_ID}/${MESSAGE_ID}`;

function BriefLayout() {
	return createElement(BriefPane, {
		thread: useOpenThreadPath(),
		// biome-ignore lint/correctness/noChildrenProp: no JSX in a `.ts` test, and createElement's variadic children do not satisfy a required prop
		children: [
			createElement(BriefPane.List, { key: "list" }),
			createElement(Outlet, { key: "reading" }),
		],
	});
}

const briefRouter = (href: string): AnyRouter => {
	const rootRoute = createRootRoute({
		component: () =>
			createElement(
				ComposeProvider,
				null,
				createElement(MailFreshnessProvider, {
					accountIds: [],
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

/**
 * Narrow, where the reading pane does not follow the cursor: on desktop the
 * first `j` would open the row it lands on, which is the very state the closed
 * case is here to read.
 */
const mountBrief = async (href: string): Promise<[DomHarness, AnyRouter]> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: [threadMessage] };
		}
		if (call.path.endsWith(`/messages/${MESSAGE_ID}`)) return describeMessage;
		if (call.path.includes("/threads")) return { items: [threadMessage] };
		return { items: [] };
	});

	const router = briefRouter(href);
	await router.load();
	const mounted = createDomHarness({
		viewportWidth: 420,
		pointer: "coarse",
		orientation: "portrait",
	});
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
	return [mounted, router];
};

describe("a real pane's own answer for hasOpenThread (#723)", () => {
	it("leaves a with nothing to do while the brief has a thread open", async () => {
		const [mounted, router] = await mountBrief(BRIEF_MESSAGE_PATH);

		await press(mounted, "a");

		assert.equal(
			router.state.location.pathname,
			BRIEF_MESSAGE_PATH,
			"the brief answered a message of its own choosing under the open conversation",
		);
	});

	it("answers the cursor's row with a once the brief has no thread open", async () => {
		const [mounted, router] = await mountBrief(BRIEF_LIST_PATH);

		await press(mounted, "j");
		await press(mounted, "a");

		assert.equal(
			router.state.location.pathname,
			`${BRIEF_MESSAGE_PATH}/reply-all`,
			"the brief kept a dropped with no conversation to hand it to",
		);
	});
});
