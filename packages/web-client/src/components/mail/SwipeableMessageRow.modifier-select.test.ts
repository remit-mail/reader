/**
 * A modifier can only come from a real keyboard, so the touch row honours it at
 * every width (#586).
 *
 * Below 1024px the list renders the swipe row, which reads a press as a pointer
 * gesture and opens the message from the release. Shift and cmd have to reach
 * selection before that gesture starts, or a half-screen window and a tablet
 * with a keyboard can only ever open messages one at a time.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type { SelectionModifiers } from "@remit/ui";
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

const HALF_SCREEN_WIDTH = 900;

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
const messageRoute = createRoute({
	getParentRoute: () => mailRoute,
	path: "$threadId/$messageId",
});

interface Mounted {
	row: HTMLElement;
	router: AnyRouter;
	selects: SelectionModifiers[];
}

const mountRow = (selectionTakesIt = true): Mounted => {
	const selects: SelectionModifiers[] = [];
	const router = createRouter({
		routeTree: rootRoute.addChildren([mailRoute.addChildren([messageRoute])]),
		history: createMemoryHistory({ initialEntries: ["/mail/mbx-1"] }),
	}) as unknown as AnyRouter;
	const created = createDomHarness({ viewportWidth: HALF_SCREEN_WIDTH });
	harness = created;
	created.render(
		createElement(RouterContextProvider, {
			router,
			// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
			children: createElement(SwipeableMessageRow, {
				thread,
				mailboxId: "mbx-1",
				isSelected: false,
				isChecked: false,
				onToggleCheck: () => undefined,
				onRowSelect: (_id: string, modifiers: SelectionModifiers) => {
					selects.push(modifiers);
					return selectionTakesIt;
				},
				isMultiSelectMode: false,
				onLongPress: () => undefined,
				isDesktop: false,
				onDelete: () => undefined,
				onToggleRead: () => undefined,
			}),
		}),
	);
	const row = created.query("button[data-message-row]");
	assert.ok(row, "the swipe row did not mount");
	return { row, router, selects };
};

const press = (
	row: Element,
	modifiers: Partial<SelectionModifiers> = {},
): PointerEvent => {
	const event = new PointerEvent("pointerdown", {
		bubbles: true,
		cancelable: true,
		pointerId: 1,
		clientX: 10,
		clientY: 10,
		shiftKey: modifiers.shiftKey ?? false,
		metaKey: modifiers.metaKey ?? false,
		ctrlKey: modifiers.ctrlKey ?? false,
	});
	harness?.dispatch(row, event);
	return event;
};

const release = (row: Element): void => {
	harness?.dispatch(
		row,
		new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }),
	);
};

// A press whose default was taken still delivers a click, so the click has to
// be consumed too rather than reaching selection a second time.
const click = (
	row: Element,
	modifiers: Partial<SelectionModifiers> = {},
): void =>
	harness?.dispatch(
		row,
		new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			shiftKey: modifiers.shiftKey ?? false,
			metaKey: modifiers.metaKey ?? false,
			ctrlKey: modifiers.ctrlKey ?? false,
		}),
	);

// The conversation the row opened is the address, so the message it named is the
// last segment of the path.
const openedMessageId = (router: AnyRouter): string | undefined =>
	router.state.location.pathname.split("/")[4];

describe("SwipeableMessageRow — modifier selection below the desktop width", () => {
	it("takes a shift-press for selection instead of opening the message", async () => {
		const { row, router, selects } = mountRow();

		const event = press(row, { shiftKey: true });
		release(row);
		await harness?.flush();

		assert.deepEqual(selects, [
			{ shiftKey: true, metaKey: false, ctrlKey: false },
		]);
		assert.equal(event.defaultPrevented, true);
		assert.equal(openedMessageId(router), undefined);
	});

	it("takes a cmd-press for selection instead of opening the message", async () => {
		const { row, router, selects } = mountRow();

		press(row, { metaKey: true });
		release(row);
		click(row, { metaKey: true });
		await harness?.flush();

		assert.deepEqual(selects, [
			{ shiftKey: false, metaKey: true, ctrlKey: false },
		]);
		assert.equal(openedMessageId(router), undefined);
	});

	it("drops the native text selection a shift-press would drag across rows", () => {
		const { row } = mountRow();
		const selection = harness?.window.getSelection();
		assert.ok(selection, "jsdom exposes no selection");
		const range = harness?.document.createRange();
		assert.ok(range, "jsdom exposes no range");
		range.selectNodeContents(row);
		selection.removeAllRanges();
		selection.addRange(range);

		press(row, { shiftKey: true });

		assert.equal(selection.rangeCount, 0);
	});

	it("suppresses the context menu a ctrl-press already spent on selection", () => {
		const { row, selects } = mountRow();

		press(row, { ctrlKey: true });
		const menu = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			ctrlKey: true,
		});
		harness?.dispatch(row, menu);

		assert.deepEqual(selects, [
			{ shiftKey: false, metaKey: false, ctrlKey: true },
		]);
		assert.equal(menu.defaultPrevented, true);
	});

	it("opens on an unmodified tap", async () => {
		const { row, router, selects } = mountRow();

		press(row);
		release(row);
		click(row);
		await harness?.flush();

		assert.deepEqual(selects, []);
		assert.equal(openedMessageId(router), "msg-1");
	});

	it("opens when selection declines the modified press", async () => {
		const { row, router } = mountRow(false);

		press(row, { metaKey: true });
		release(row);
		await harness?.flush();

		assert.equal(openedMessageId(router), "msg-1");
	});
});
