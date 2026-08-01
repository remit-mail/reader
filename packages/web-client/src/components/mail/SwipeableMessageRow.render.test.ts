/**
 * The touch row is not an anchor (#116).
 *
 * An `<a href>` is what the OS long-press callout and the link context menu
 * fire on, and they raced the row's own long-press-to-select gesture. Nothing
 * an anchor buys — middle-click, open in new tab, copy link address — exists
 * without a mouse, and the swipe row is the touch row.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { SwipeableMessageRow } from "./SwipeableMessageRow";

const PHONE_WIDTH = 390;

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

const thread = {
	threadMessageId: "tm-1",
	threadId: "th-1",
	messageId: "msg-1",
	accountId: "acc-1",
	accountConfigId: "acc-1",
	mailboxId: "mbx-1",
	subject: "Q3 planning notes",
	fromName: "Alex Rivera",
	fromEmail: "alex@example.com",
	snippet: "Notes from the planning session.",
	sentDate: 0,
	isRead: false,
	hasAttachment: false,
	hasStars: false,
	star: "None",
	isDeleted: false,
	senderTrust: "unknown",
	createdAt: 0,
	updatedAt: 0,
} as unknown as RemitImapThreadMessageResponse;

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const rootRoute = createRootRoute();
const mailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mail/$mailboxId",
});

const testRouter = (): AnyRouter =>
	createRouter({
		routeTree: rootRoute.addChildren([mailRoute]),
		history: createMemoryHistory({ initialEntries: ["/mail/mbx-1"] }),
	}) as unknown as AnyRouter;

const renderRow = (): DomHarness => {
	const created = createDomHarness({ viewportWidth: PHONE_WIDTH });
	created.render(
		createElement(RouterContextProvider, {
			router: testRouter(),
			// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
			children: createElement(SwipeableMessageRow, {
				thread,
				mailboxId: "mbx-1",
				isSelected: false,
				isChecked: false,
				onToggleCheck: () => undefined,
				onRowSelect: () => false,
				isMultiSelectMode: false,
				onLongPress: () => undefined,
				isDesktop: false,
				onDelete: () => undefined,
				onToggleRead: () => undefined,
			}),
		}),
	);
	return created;
};

describe("SwipeableMessageRow — the touch row's open affordance", () => {
	it("renders no anchor at all", () => {
		harness = renderRow();

		assert.equal(harness.queryAll("a").length, 0);
	});

	it("opens through a button carrying the row marker", () => {
		harness = renderRow();

		const row = harness.query("button[data-message-row]");
		assert.ok(row, "the row's open affordance is not a button");
		assert.match(row.textContent ?? "", /Q3 planning notes/);
	});
});
