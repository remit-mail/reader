/**
 * Which identity answers a message, on an instance holding more than one.
 *
 * The account a message reached is the mailbox it was delivered to, so the
 * reply leaves from that identity, the Reply All keeps that identity out of
 * its own Cc, and reading the message refreshes that account's folder list.
 * All three read the first configured account before (#819), which answered
 * every account's mail as the first one.
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
import {
	makeAccount,
	makeMailbox,
	makeThreadMessage,
} from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { MARK_READ_DELAY_MS } from "../../hooks/useMarkAsRead";
import { ConversationView } from "./ConversationView";

const FIRST_ACCOUNT_ID = "acc-first";
const REACHED_ACCOUNT_ID = "acc-reached";
const FIRST_MAILBOX_ID = "mbx-first-inbox";
const REACHED_MAILBOX_ID = "mbx-reached-inbox";
const THREAD_ID = "thread-1";
const MESSAGE_ID = "msg-1";

const REACHED_EMAIL = "bob@example.com";

// Two identities, in the order the config hands them over. The message below
// reached the second one, so nothing about it can be answered off the head of
// this list.
const firstAccount = makeAccount({
	accountId: FIRST_ACCOUNT_ID,
	email: "alice@example.com",
	username: "alice@example.com",
	smtpUsername: "alice@example.com",
});

const reachedAccount = makeAccount({
	accountId: REACHED_ACCOUNT_ID,
	email: REACHED_EMAIL,
	username: REACHED_EMAIL,
	smtpUsername: REACHED_EMAIL,
});

const firstMailbox = makeMailbox({
	mailboxId: FIRST_MAILBOX_ID,
	accountId: FIRST_ACCOUNT_ID,
	fullPath: "INBOX",
});

const reachedMailbox = makeMailbox({
	mailboxId: REACHED_MAILBOX_ID,
	accountId: REACHED_ACCOUNT_ID,
	fullPath: "INBOX",
});

const threadMessage = (isRead: boolean): RemitImapThreadMessageResponse =>
	makeThreadMessage({
		messageId: MESSAGE_ID,
		threadId: THREAD_ID,
		mailboxId: REACHED_MAILBOX_ID,
		accountId: REACHED_ACCOUNT_ID,
		subject: "Lunch Thursday?",
		fromName: "Ada Lovelace",
		fromEmail: "ada@example.com",
		isRead,
	});

// Sent to the second identity, with a third party alongside it. A Reply All
// answers Ada and keeps Carol; the reader's own address is the one address that
// must not come back in the Cc.
const describeMessage: RemitImapDescribeMessageResponse = {
	message: {
		messageId: MESSAGE_ID,
		mailboxId: REACHED_MAILBOX_ID,
		uid: 1,
		rfc822Size: 512,
		internalDate: 1_767_225_600_000,
		status: "active",
		syncStatus: "pending",
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
				addressId: "addr-reached",
				normalizedEmail: REACHED_EMAIL,
				addressRole: "to",
				addressOrder: 0,
			},
		],
		cc: [
			{
				addressId: "addr-carol",
				normalizedEmail: "carol@example.com",
				addressRole: "cc",
				addressOrder: 0,
			},
		],
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

const MESSAGE_PATH = `/mail/${REACHED_MAILBOX_ID}/${THREAD_ID}/${MESSAGE_ID}`;

const testRouter = (href: string): AnyRouter => {
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
				mailboxId: REACHED_MAILBOX_ID,
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

const mountAt = async (
	href: string,
	{ isRead = true }: { isRead?: boolean } = {},
): Promise<DomHarness> => {
	const messages = [threadMessage(isRead)];
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) {
			return { accounts: [firstAccount, reachedAccount] };
		}
		if (call.path.endsWith(`/accounts/${FIRST_ACCOUNT_ID}/mailboxes`)) {
			return { items: [firstMailbox] };
		}
		if (call.path.endsWith(`/accounts/${REACHED_ACCOUNT_ID}/mailboxes`)) {
			return { items: [reachedMailbox] };
		}
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: messages };
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
	return harness;
};

/** The identity the From row is standing on. */
const chosenIdentity = (mounted: DomHarness): string => {
	const selector = mounted.query<HTMLSelectElement>("#from-account-selector");
	assert.ok(selector, "the From row offers the configured identities");
	return selector.value;
};

/** The addresses held as chips in one of the composer's recipient fields. */
const recipients = (mounted: DomHarness, label: string): string[] => {
	const input = mounted.query(`#address-field-${label}`);
	assert.ok(input, `the ${label} field is on screen`);
	const field = input.parentElement;
	assert.ok(field, `the ${label} field holds its chips`);
	return [...field.querySelectorAll("[aria-label^='Remove ']")].map((button) =>
		(button.getAttribute("aria-label") ?? "").replace("Remove ", ""),
	);
};

const mailboxListReads = (accountId: string): number =>
	(http?.calls ?? []).filter(
		(call) =>
			call.method === "GET" &&
			call.path.endsWith(`/accounts/${accountId}/mailboxes`),
	).length;

describe("answering from the identity the message reached", () => {
	it("opens the reply on the account the message was delivered to", async () => {
		const mounted = await mountAt(`${MESSAGE_PATH}/reply`);

		assert.equal(
			chosenIdentity(mounted),
			REACHED_ACCOUNT_ID,
			"the reply leaves from the identity the message reached, not the first one configured",
		);
	});

	it("keeps the reached identity out of its own Reply All", async () => {
		const mounted = await mountAt(`${MESSAGE_PATH}/reply-all`);

		assert.deepEqual(
			recipients(mounted, "To"),
			["ada@example.com"],
			"the answer goes back to the sender",
		);
		assert.deepEqual(
			recipients(mounted, "Cc"),
			["carol@example.com"],
			"everyone else on the message is kept, and the reader's own address is not copied back to itself",
		);
	});

	it("refreshes the folder list of the account the message was read in", async () => {
		const mounted = await mountAt(MESSAGE_PATH, { isRead: false });

		const readsBefore = {
			first: mailboxListReads(FIRST_ACCOUNT_ID),
			reached: mailboxListReads(REACHED_ACCOUNT_ID),
		};

		await mounted.wait(MARK_READ_DELAY_MS + 100);
		await mounted.flush();

		assert.equal(
			(http?.to("/messages/flags") ?? []).length,
			1,
			"the message the reader dwelled on was marked read",
		);
		assert.ok(
			mailboxListReads(REACHED_ACCOUNT_ID) > readsBefore.reached,
			"the unread badge of the account the message was read in is refreshed",
		);
		assert.equal(
			mailboxListReads(FIRST_ACCOUNT_ID),
			readsBefore.first,
			"no other account's folder list is disturbed",
		);
	});
});
