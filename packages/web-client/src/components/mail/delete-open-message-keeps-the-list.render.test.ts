/**
 * Deleting the open message leaves the reader on the list they are browsing
 * (#798, #946).
 *
 * The row vanishes optimistically, so the address that names it has to move
 * before the server answers. It moves up to the list underneath — the brief,
 * Flagged, the folder — and never to the deleted message's own home folder,
 * which ejected a reader out of the brief into a folder they had not opened.
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
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { MessageActionMenu } from "./MessageActionMenu";

const THREAD_ID = "thread-1";
const MESSAGE_ID = "msg-1";
const MAILBOX_ID = "mbx-inbox";

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
 * The three lists a conversation can be opened from, each with the thread and
 * the message under it. The menu is what the message route mounts, so the
 * mailbox it is handed is the message's own — which on the brief and on Flagged
 * is not the list being browsed.
 */
const testRouter = (href: string): AnyRouter => {
	const rootRoute = createRootRoute({ component: Outlet });
	const mailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/mail",
		validateSearch: (search: Record<string, unknown>) => search,
		component: Outlet,
	});
	const listRoute = (path: string) => {
		const list = createRoute({
			getParentRoute: () => mailRoute,
			path,
			component: Outlet,
		});
		const thread = createRoute({
			getParentRoute: () => list,
			path: "$threadId",
			component: Outlet,
		});
		const message = createRoute({
			getParentRoute: () => thread,
			path: "$messageId",
			component: () =>
				createElement(MessageActionMenu, {
					messageId: MESSAGE_ID,
					threadId: THREAD_ID,
					mailboxId: MAILBOX_ID,
					isRead: true,
				}),
		});
		return list.addChildren([thread.addChildren([message])]);
	};
	const routeTree = rootRoute.addChildren([
		mailRoute.addChildren([
			listRoute("/brief"),
			listRoute("/flagged"),
			listRoute("/$mailboxId"),
		]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [href] }),
	}) as unknown as AnyRouter;
};

const settle = async (mounted: DomHarness): Promise<void> => {
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
};

const mountAt = async (href: string): Promise<[DomHarness, AnyRouter]> => {
	http = mockFetch(() => ({}));
	const router = testRouter(href);
	await router.load();
	const mounted = createDomHarness();
	harness = mounted;
	mounted.renderApp(createElement(RouterProvider, { router }));
	await settle(mounted);
	return [mounted, router];
};

/** The overflow menu on the open message, and the Delete inside it. */
const pressDelete = async (mounted: DomHarness): Promise<void> => {
	const overflow = mounted.query("button");
	assert.ok(overflow, "the message carries an overflow menu");
	mounted.click(overflow);
	await mounted.flush();

	mounted.click(mounted.byText("button", "Delete"));
	await settle(mounted);
};

describe("deleting the open message keeps the list it was opened from", () => {
	it("stays on the brief", async () => {
		const [mounted, router] = await mountAt(
			`/mail/brief/${THREAD_ID}/${MESSAGE_ID}`,
		);

		await pressDelete(mounted);

		assert.equal(router.state.location.pathname, "/mail/brief");
	});

	it("stays on the flagged list", async () => {
		const [mounted, router] = await mountAt(
			`/mail/flagged/${THREAD_ID}/${MESSAGE_ID}`,
		);

		await pressDelete(mounted);

		assert.equal(router.state.location.pathname, "/mail/flagged");
	});

	it("stays in the folder being browsed", async () => {
		const [mounted, router] = await mountAt(
			`/mail/${MAILBOX_ID}/${THREAD_ID}/${MESSAGE_ID}`,
		);

		await pressDelete(mounted);

		assert.equal(router.state.location.pathname, `/mail/${MAILBOX_ID}`);
	});
});
