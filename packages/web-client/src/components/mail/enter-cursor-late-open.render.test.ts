/**
 * Enter opens the row the keyboard cursor is on, even while the reading pane is
 * still catching up to an earlier cursor move.
 *
 * On desktop the pane follows the cursor: a `j` opens its row a beat later. That
 * open is a navigation, and the list only learns of it when the route hands the
 * opened row back as `selectedMessageId`. If the user pressed `j` again in
 * between, the late arrival used to drag the cursor back to the row it opened,
 * so Enter opened the earlier row instead of the one under the cursor.
 *
 * The host below holds `selectedMessageId` back on purpose, which is what makes
 * that window as wide as the test needs: the URL moves at once, the list hears
 * about it only when the test releases it.
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
import { act, createElement, createRef, useState } from "react";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeAccount, makeThreadMessage } from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { MessageList, type MessageListCommands } from "./MessageList";

const MAILBOX_ID = "mbx-inbox";
const LIST_PATH = `/mail/${MAILBOX_ID}`;

const threads = ["msg-a", "msg-b", "msg-c"].map((messageId) =>
	makeThreadMessage({
		messageId,
		threadId: `thread-${messageId}`,
		mailboxId: MAILBOX_ID,
	}),
);
const [FIRST, SECOND] = threads;

const openPath = (messageId: string): string =>
	`${LIST_PATH}/thread-${messageId}/${messageId}`;

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

interface Mounted {
	mounted: DomHarness;
	router: AnyRouter;
	commands: () => MessageListCommands;
	cursor: () => string | undefined;
	releaseOpen: (messageId: string) => void;
}

const mount = async (): Promise<Mounted> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/config")) {
			return { accounts: [makeAccount({ accountId: "acc-1" })] };
		}
		return { items: [] };
	});

	const commandsRef = createRef<MessageListCommands | null>();
	let cursor: string | undefined;
	let setSelected: ((messageId: string | undefined) => void) | undefined;

	const Host = () => {
		const [selected, set] = useState<string | undefined>(undefined);
		setSelected = set;
		return createElement(
			"div",
			null,
			createElement(MessageList, {
				mailboxId: MAILBOX_ID,
				accountId: "acc-1",
				threads,
				selectedMessageId: selected,
				isLoading: false,
				listTitle: "Inbox",
				commandsRef,
				onTriageContextChange: (context) => {
					cursor = context.focusedMessageId;
				},
			}),
			createElement(Outlet),
		);
	};

	const rootRoute = createRootRoute({ component: Outlet });
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		validateSearch: (search: Record<string, unknown>) => search,
		component: Outlet,
	});
	const mailboxRoute = createRoute({
		getParentRoute: () => mailRoute,
		path: "$mailboxId",
		component: Host,
	});
	const listRoute = createRoute({
		getParentRoute: () => mailboxRoute,
		path: "/",
	});
	const threadRoute = createRoute({
		getParentRoute: () => mailboxRoute,
		path: "$threadId",
	});
	const messageRoute = createRoute({
		getParentRoute: () => threadRoute,
		path: "$messageId",
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([
			mailRoute.addChildren([
				mailboxRoute.addChildren([
					listRoute,
					threadRoute.addChildren([messageRoute]),
				]),
			]),
		]),
		history: createMemoryHistory({ initialEntries: [LIST_PATH] }),
	}) as unknown as AnyRouter;
	await router.load();

	const mounted = createDomHarness({ viewportWidth: 1440 });
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await mounted.waitFor(
		() => commandsRef.current !== null,
		"the list published its commands",
	);

	return {
		mounted,
		router,
		commands: () => {
			const commands = commandsRef.current;
			assert.ok(commands, "the list is mounted");
			return commands;
		},
		cursor: () => cursor,
		releaseOpen: (messageId) => act(() => setSelected?.(messageId)),
	};
};

describe("Enter after a cursor move the reading pane has not caught up to", () => {
	it("keeps the cursor on the newer row and opens that row", async () => {
		const { mounted, router, commands, cursor, releaseOpen } = await mount();

		act(() => commands().focusNext());
		await mounted.waitFor(
			() => router.state.location.pathname === openPath(FIRST.messageId),
			"the pane followed the cursor onto the first row",
		);

		act(() => commands().focusNext());
		await mounted.flush();
		assert.equal(cursor(), SECOND.messageId, "j moved the cursor on");

		releaseOpen(FIRST.messageId);
		await mounted.flush();

		assert.equal(
			cursor(),
			SECOND.messageId,
			"the late open dragged the cursor back to the row it opened",
		);

		const pushesBefore = router.history.length;
		act(() => commands().openFocused());
		await mounted.waitFor(
			() => router.history.length > pushesBefore,
			"Enter opened a row",
		);
		assert.equal(
			router.state.location.pathname,
			openPath(SECOND.messageId),
			"Enter opened a row other than the one under the cursor",
		);
	});
});
