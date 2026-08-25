/**
 * One press moves one cursor (#723).
 *
 * A thread list and an open conversation each carry a cursor, and both used to
 * run a keydown listener of their own on the window. With a thread open both
 * were mounted, so `j` moved the list cursor and the conversation cursor on the
 * same press — and on the desktop tiers the reading pane follows the list
 * cursor, so the thread being read was replaced underneath the turn the other
 * cursor had just moved to.
 *
 * The cursor keys have one owner: the list wherever one is mounted, the
 * conversation where none is. Both cases are here, because a fix that silences
 * the conversation everywhere would pass the first and lose the phone's reading
 * view entirely.
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
const MESSAGE_PATH = `/mail/${MAILBOX_ID}/${THREAD_ID}/${MESSAGE_ID}`;

const account = makeAccount({ accountId: ACCOUNT_ID });

const OPENING_SENT = 1_767_139_200_000;
const LATEST_SENT = 1_767_225_600_000;

// Two turns, so the conversation's cursor has somewhere to go. The API hands
// them over oldest first (#81); the pane reads them newest first.
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

/** Every move a list cursor was asked to make. */
interface ListMoves {
	focusNext: number;
	focusPrevious: number;
	openFocused: number;
}

const noMoves = (): ListMoves => ({
	focusNext: 0,
	focusPrevious: 0,
	openFocused: 0,
});

/**
 * A list standing in for `MessageList` at the seam it publishes through: the
 * commands ref and the context update that says a list is mounted. Nothing here
 * listens for a key — a real list has not done that since #43, which is the
 * whole point.
 */
const stubListCommands = (moves: ListMoves): MessageListCommands => ({
	focusNext: () => {
		moves.focusNext += 1;
	},
	focusPrevious: () => {
		moves.focusPrevious += 1;
	},
	focusFirst: () => undefined,
	focusLast: () => undefined,
	openFocused: () => {
		moves.openFocused += 1;
	},
	toggleSelect: () => undefined,
	extendSelectDown: () => undefined,
	extendSelectUp: () => undefined,
	selectAll: () => undefined,
	clearSelection: () => false,
	requestVerb: () => false,
	toggleDensity: () => undefined,
});

/**
 * A pane the way the three real ones are built: the triage context, a list that
 * may or may not be mounted beside the reading pane, and the keyboard layer
 * over both. The desktop tiers keep the list mounted with a thread open; the
 * phone's reading view replaces it.
 */
function Pane({ moves }: { moves: ListMoves | undefined }) {
	const triage = useTriageContext();
	const { listCommandsRef, onTriageContextChange } = triage;

	useEffect(() => {
		if (!moves) return;
		listCommandsRef.current = stubListCommands(moves);
		onTriageContextChange({
			focusedMessageId: MESSAGE_ID,
			selectedIds: [],
			hasList: true,
			blocksKeyboard: false,
		});
		return () => {
			listCommandsRef.current = null;
		};
	}, [moves, listCommandsRef, onTriageContextChange]);

	useTriageLayer({
		context: triage,
		orderedIds: [MESSAGE_ID],
		selectedMessageId: MESSAGE_ID,
		onClose: () => undefined,
		handlers: {},
	});

	return createElement(ConversationView, {
		threadId: THREAD_ID,
		mailboxId: MAILBOX_ID,
		subject: "Lunch Thursday?",
		selectedMessageId: MESSAGE_ID,
		onCursorChange: triage.onConversationCursorChange,
	});
}

const testRouter = (moves: ListMoves | undefined): AnyRouter => {
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
		component: () => createElement(Pane, { moves }),
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
		history: createMemoryHistory({ initialEntries: [MESSAGE_PATH] }),
	}) as unknown as AnyRouter;
};

const mount = async (moves: ListMoves | undefined): Promise<DomHarness> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: [openingMessage, threadMessage] };
		}
		if (call.path.endsWith(`/messages/${MESSAGE_ID}`)) return describeMessage;
		return { items: [] };
	});

	const router = testRouter(moves);
	await router.load();
	const mounted = createDomHarness();
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
	return mounted;
};

/** The inset ring `MessageCard` draws on the turn the keyboard is sitting on. */
const FOCUS_RING = /ring-accent\//;

/** The turn the conversation's cursor is on, read off the ring. */
const focusedTurn = (mounted: DomHarness): string => {
	const thread = mounted.query('[data-testid="conversation-messages"]');
	assert.ok(thread, "the thread is on screen");
	const focused = [...thread.children].filter((card) =>
		[...card.querySelectorAll("*")].some((node) =>
			FOCUS_RING.test(node.getAttribute("class") ?? ""),
		),
	);
	assert.equal(focused.length, 1, "one turn carries the keyboard focus");
	return focused[0]?.textContent ?? "";
};

const press = async (mounted: DomHarness, key: string): Promise<void> => {
	mounted.dispatch(
		mounted.window,
		new mounted.window.KeyboardEvent("keydown", { key, bubbles: true }),
	);
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
};

describe("a thread open beside its list", () => {
	it("moves the list cursor and leaves the conversation's where it was", async () => {
		const moves = noMoves();
		const mounted = await mount(moves);

		assert.ok(
			focusedTurn(mounted).includes("Ada Lovelace"),
			"the conversation starts on the turn at the top",
		);

		await press(mounted, "j");

		assert.equal(moves.focusNext, 1, "the list cursor did not take the press");
		assert.ok(
			focusedTurn(mounted).includes("Ada Lovelace"),
			"the same press moved the conversation's cursor too",
		);
	});

	it("gives k to the list alone as well", async () => {
		const moves = noMoves();
		const mounted = await mount(moves);

		await press(mounted, "j");
		await press(mounted, "k");

		assert.equal(moves.focusPrevious, 1, "the list cursor did not take k");
		assert.ok(
			focusedTurn(mounted).includes("Ada Lovelace"),
			"k moved the conversation's cursor as well as the list's",
		);
	});
});

describe("a thread open with no list beside it", () => {
	it("walks the thread with j and k, in the order it is displayed in", async () => {
		const mounted = await mount(undefined);

		assert.ok(
			focusedTurn(mounted).includes("Ada Lovelace"),
			"the keyboard starts on the turn at the top, which is the latest one",
		);

		// Down the pane is back in time, because the thread reads newest first.
		await press(mounted, "j");
		assert.ok(
			focusedTurn(mounted).includes("Grace Hopper"),
			"j moves to the turn below, which is the older one",
		);

		await press(mounted, "k");
		assert.ok(
			focusedTurn(mounted).includes("Ada Lovelace"),
			"k moves to the turn above, which is the newer one",
		);
	});
});
