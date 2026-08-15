/**
 * Reading a message and answering it, on a desktop pane.
 *
 * The reply leads the pane and the thread reads newest first under it, so what
 * is being written and the turn it answers are the two things at the top. Both
 * live in the pane's own scrolling region: the reply has no height of its own
 * and no scroller of its own, which is what kept a second scrollbar — with the
 * caret in the inner one — out of a single column.
 *
 * The chevron beside the sender is the control that puts a message away.
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
import { createElement } from "react";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeAccount, makeThreadMessage } from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { ConversationView } from "./ConversationView";

const ACCOUNT_ID = "acc-1";
const THREAD_ID = "thread-1";
const MAILBOX_ID = "mbx-inbox";
const MESSAGE_ID = "msg-1";

const account = makeAccount({ accountId: ACCOUNT_ID });

const OPENING_SENT = 1_767_139_200_000;
const LATEST_SENT = 1_767_225_600_000;

// The turn that opened the conversation, and the one that answered it. The API
// hands them over oldest first (#81), which is the order this mock serves them
// in — the pane is what decides which end of that goes at the top.
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
	// Already read: marking one read on open is a mutation this test has no
	// business driving.
	isRead: true,
});

const describeMessage: RemitImapDescribeMessageResponse = {
	message: {
		messageId: MESSAGE_ID,
		mailboxId: MAILBOX_ID,
		uid: 1,
		rfc822Size: 512,
		internalDate: 1_767_225_600_000,
	},
	envelope: {
		messageId: MESSAGE_ID,
		date: 1_767_225_600_000,
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
const REPLY_PATH = `${MESSAGE_PATH}/reply`;

// The conversation is what the message route renders, and the reply is the
// segment under it — so the tree here is the app's: the folder, the thread, the
// message, and the mode below it. The address is what opens the reply, so the
// cases below mount at one or the other.
const testRouter = (href: string): AnyRouter => {
	// The compose provider sits at the root the way `__root.tsx` mounts it.
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
		component: () =>
			createElement(ConversationView, {
				threadId: THREAD_ID,
				mailboxId: MAILBOX_ID,
				subject: "Lunch Thursday?",
				selectedMessageId: MESSAGE_ID,
			}),
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

const mountAt = async (href: string): Promise<[DomHarness, AnyRouter]> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: [openingMessage, threadMessage] };
		}
		if (call.path.endsWith(`/messages/${MESSAGE_ID}`)) return describeMessage;
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

/** The conversation, with nothing being written under it. */
const mount = async (): Promise<DomHarness> => {
	const [mounted] = await mountAt(MESSAGE_PATH);
	return mounted;
};

/**
 * The same conversation at the address that names a reply — which is the whole
 * of what opens one. A cold load rather than a press, because the reply is the
 * segment and not a state a keystroke sets.
 */
const mountReplying = async (): Promise<DomHarness> => {
	const [mounted] = await mountAt(REPLY_PATH);
	return mounted;
};

/** The r shortcut the reading pane binds — how a reader asks for the reply. */
const pressReply = async (mounted: DomHarness): Promise<void> => {
	mounted.dispatch(
		mounted.window,
		new mounted.window.KeyboardEvent("keydown", { key: "r", bubbles: true }),
	);
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
};

/**
 * Which region of the pane a node belongs to — the pane's own child that holds
 * it. Two nodes in the same region move together; two in different ones are
 * separate bands of the pane, each with whatever height the other leaves.
 */
const paneRegionHolding = (pane: Element, node: Node): Element | null =>
	[...pane.children].find((child) => child.contains(node)) ?? null;

/**
 * The utilities that make an element scroll vertically. A horizontal one — the
 * formatting toolbar's strip of buttons — is a different thing and is not
 * counted: it holds a row that would otherwise be cut off, not a column of
 * content the reader moves through.
 */
const SCROLLS_VERTICALLY = /(^|\s)overflow-(auto|scroll|y-auto|y-scroll)(\s|$)/;

/** The inset ring `MessageCard` draws on the row the keyboard is sitting on. */
const FOCUS_RING = /ring-accent\//;

/** The turn the keyboard has, read off the ring rather than off the index. */
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

const verticalScrollers = (root: Element): Element[] =>
	[root, ...root.querySelectorAll("*")].filter((node) =>
		SCROLLS_VERTICALLY.test(node.getAttribute("class") ?? ""),
	);

describe("answering the message that is open", () => {
	it("puts the reply in the same scrolling region as the message", async () => {
		const mounted = await mountReplying();

		const pane = mounted.query("article");
		assert.ok(pane, "the conversation pane is mounted");

		const compose = mounted.query('[data-testid="compose-body-area"]');
		assert.ok(compose, "the reply opened");

		const message = mounted.query('[data-testid="message-date"]');
		assert.ok(message, "the message is on screen");

		// Compared as a boolean: an assertion over two DOM nodes serializes the
		// whole jsdom graph into its failure message.
		assert.ok(
			paneRegionHolding(pane, compose) === paneRegionHolding(pane, message),
			"the reply scrolls with the message instead of sitting in a band below it, where a long message leaves it no height",
		);
	});

	it("leads the pane with the reply, above the thread it answers", async () => {
		const mounted = await mountReplying();

		const compose = mounted.query('[data-testid="compose-body-area"]');
		assert.ok(compose, "the reply opened");

		const thread = mounted.query('[data-testid="conversation-messages"]');
		assert.ok(thread, "the thread is on screen");

		const following = mounted.window.Node.DOCUMENT_POSITION_FOLLOWING;
		assert.ok(
			(compose.compareDocumentPosition(thread) & following) === following,
			"the reply comes before the messages, not after the last of them",
		);
	});

	it("reads the thread newest first", async () => {
		const mounted = await mount();

		const thread = mounted.query('[data-testid="conversation-messages"]');
		assert.ok(thread, "the thread is on screen");

		const cards = [...thread.children].map((card) => card.textContent ?? "");
		assert.equal(cards.length, 2, "both turns are on screen");
		assert.ok(
			cards[0]?.includes("Ada Lovelace"),
			"the turn that answered the conversation is at the top",
		);
		assert.ok(
			cards[1]?.includes("Grace Hopper"),
			"the turn that opened it is below",
		);
	});

	it("walks the thread with j and k in the order it is displayed in", async () => {
		const mounted = await mount();

		assert.ok(
			focusedTurn(mounted).includes("Ada Lovelace"),
			"the keyboard starts on the turn at the top, which is the latest one",
		);

		const press = async (key: string): Promise<void> => {
			mounted.dispatch(
				mounted.window,
				new mounted.window.KeyboardEvent("keydown", { key, bubbles: true }),
			);
			await mounted.flush();
		};

		// Down the pane is back in time now that the thread reads newest first.
		// A reorder that left the handlers alone would invert this silently, and
		// the help overlay describes the same direction this asserts.
		await press("j");
		assert.ok(
			focusedTurn(mounted).includes("Grace Hopper"),
			"j moves to the turn below, which is the older one",
		);

		await press("k");
		assert.ok(
			focusedTurn(mounted).includes("Ada Lovelace"),
			"k moves to the turn above, which is the newer one",
		);
	});

	it("gives the pane one scrollbar with nothing being written", async () => {
		const mounted = await mount();

		const pane = mounted.query("article");
		assert.ok(pane, "the conversation pane is mounted");
		assert.equal(
			verticalScrollers(pane).length,
			1,
			"reading a thread scrolls one thing",
		);
	});

	it("gives the pane one scrollbar with the reply open", async () => {
		const mounted = await mountReplying();

		const pane = mounted.query("article");
		assert.ok(pane, "the conversation pane is mounted");
		assert.equal(
			verticalScrollers(pane).length,
			1,
			"the reply is a block of the pane, not a box with a scrollbar of its own next to the editor",
		);
	});

	// The address is the whole of what opens a reply, so what the key does is
	// move it: the mode lands under the message that was open, and the thread
	// that was matched behind it stays matched.
	it("moves the address to the reply under the open message", async () => {
		const [mounted, router] = await mountAt(MESSAGE_PATH);

		await pressReply(mounted);

		assert.equal(router.state.location.pathname, REPLY_PATH);
	});

	it("collapses the message from the chevron beside the sender", async () => {
		const mounted = await mount();

		assert.ok(
			mounted.text().includes("ada@example.com"),
			"the message opens expanded",
		);

		const collapse = mounted.byLabel("Collapse message");
		mounted.click(collapse);
		await mounted.flush();

		assert.ok(
			mounted.query('[aria-label="Collapse message"]') === null,
			"the chevron collapsed the message it belongs to",
		);
		assert.equal(
			mounted.queryAll('[role="button"][aria-expanded="false"]').length,
			2,
			"the message is back to a collapsed row, beside the one that was already collapsed",
		);
	});
});
