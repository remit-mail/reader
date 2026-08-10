/**
 * Reading a message and answering it, on a desktop pane.
 *
 * The inline reply was held below the conversation rather than inside it. It
 * took whatever height the message left over, which on a normal-length one is
 * nothing: the recipient rows and the verbs stayed, the writing area went down
 * to a couple of lines, and scrolling the message could not reach it because
 * the thing to reach was already on screen and squeezed.
 *
 * The reply belongs to the conversation and scrolls with it, and the chevron
 * beside the sender is the control that puts a message away — reclaiming the
 * space is what a reader reaches for it to do.
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

const threadMessage: RemitImapThreadMessageResponse = makeThreadMessage({
	messageId: MESSAGE_ID,
	threadId: THREAD_ID,
	mailboxId: MAILBOX_ID,
	accountId: ACCOUNT_ID,
	subject: "Lunch Thursday?",
	fromName: "Ada Lovelace",
	fromEmail: "ada@example.com",
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

// The conversation is what the mailbox route renders, and the per-message
// action menu reads the route's own search — so it is mounted on a route
// rather than beside one.
const testRouter = (): AnyRouter => {
	// The compose provider sits at the root the way `__root.tsx` mounts it.
	const rootRoute = createRootRoute({
		component: () =>
			createElement(ComposeProvider, null, createElement(Outlet)),
	});
	const routeTree = rootRoute.addChildren([
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/mail/$mailboxId",
			validateSearch: (search: Record<string, unknown>) => search,
			component: () =>
				createElement(ConversationView, {
					threadId: THREAD_ID,
					mailboxId: MAILBOX_ID,
					subject: "Lunch Thursday?",
				}),
		}),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [`/mail/${MAILBOX_ID}`] }),
	}) as unknown as AnyRouter;
};

const mount = async (): Promise<DomHarness> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: [threadMessage] };
		}
		if (call.path.endsWith(`/messages/${MESSAGE_ID}`)) return describeMessage;
		return { items: [] };
	});

	const router = testRouter();
	await router.load();
	harness = createDomHarness();
	harness.renderApp(createElement(RouterProvider, { router }));
	await harness.flush();
	await harness.wait(20);
	await harness.flush();
	return harness;
};

/** The r shortcut the reading pane binds — how a reader opens the reply. */
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

describe("answering the message that is open", () => {
	it("puts the reply in the same scrolling region as the message", async () => {
		const mounted = await mount();

		await pressReply(mounted);

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
		assert.ok(
			mounted.query('[role="button"][aria-expanded="false"]'),
			"the message is back to a collapsed row",
		);
	});
});
