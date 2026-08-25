/**
 * With a thread open, one `j` press must move one cursor (#723).
 *
 * `useTriageLayer` (the pane's list cursor) and `ConversationView` (the open
 * conversation's own message cursor) each bind their own keydown listener on
 * `window`. Both used to act on the same press, so opening a thread and
 * pressing `j` once walked the list underneath it and the conversation on top
 * of it at the same time. `hasOpenThread` is what makes `useTriageLayer` drop
 * the keys the conversation already owns instead of racing it for them.
 *
 * The list is stood in for by a stub `MessageListCommands` — this is the same
 * seam `MailboxPane` wires the real list through (`listCommandsRef`), so
 * standing in for it here exercises the exact handoff, without the real
 * list's virtualization along for the ride.
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
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeAccount, makeThreadMessage } from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
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

const MESSAGE_PATH = `/mail/${MAILBOX_ID}/${THREAD_ID}/${MESSAGE_ID}`;

/**
 * The pane's own wiring around an open conversation: `useTriageLayer` bound
 * to a stub list, exactly the way `MailboxPane` binds it to the real one.
 * Every list action the stub is asked for is recorded, so a press that
 * reaches the list as well as the conversation shows up here.
 */
function PaneWithOpenThread({
	onListAction,
}: {
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
		hasOpenThread: true,
		onClose: () => undefined,
		handlers: {
			reply: () => onListAction("reply"),
			forward: () => onListAction("forward"),
		},
	});

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
	const threadRoute = createRoute({
		getParentRoute: () => mailboxRoute,
		path: "$threadId",
	});
	const messageRoute = createRoute({
		getParentRoute: () => threadRoute,
		path: "$messageId",
		component: () => createElement(PaneWithOpenThread, { onListAction }),
	});
	const replyRoute = createRoute({
		getParentRoute: () => messageRoute,
		path: "$mode/{-$outboxMessageId}",
	});
	const routeTree = rootRoute.addChildren([
		mailboxRoute.addChildren([
			threadRoute.addChildren([messageRoute.addChildren([replyRoute])]),
		]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [href] }),
	}) as unknown as AnyRouter;
};

const mount = async (
	onListAction: (action: string) => void,
): Promise<DomHarness> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: [openingMessage, threadMessage] };
		}
		if (call.path.endsWith(`/messages/${MESSAGE_ID}`)) return describeMessage;
		return { items: [] };
	});

	const router = testRouter(MESSAGE_PATH, onListAction);
	await router.load();
	const mounted = createDomHarness();
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
	return mounted;
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

const pressJ = async (mounted: DomHarness): Promise<void> => {
	mounted.dispatch(
		mounted.window,
		new mounted.window.KeyboardEvent("keydown", { key: "j", bubbles: true }),
	);
	await mounted.flush();
};

describe("one j press with a thread open (#723)", () => {
	it("moves the conversation's cursor and leaves the pane's list cursor alone", async () => {
		const listActions: string[] = [];
		const mounted = await mount((action) => listActions.push(action));

		assert.ok(
			focusedTurn(mounted).includes("Ada Lovelace"),
			"the conversation cursor starts on the latest turn",
		);

		await pressJ(mounted);

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
});
