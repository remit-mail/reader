/**
 * Image gating at the `MessageCard` seam (#352). The expanded card resolves the
 * From-address flags and hands them to the body: `blocked` is read there
 * alongside `trusted`, and wins when both are set. Without that read the promise
 * Settings > Senders makes — a blocked sender never loads images — has no reach
 * into the one surface that renders mail.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapAddressFlags,
	RemitImapDescribeMessageResponse,
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
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import { makeThreadMessage } from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { MessageCard } from "./MessageCard";

const MAILBOX_ID = "mbx-inbox";
const THREAD_ID = "thread-1";
const MESSAGE_ID = "msg-1";
const CONTENT_PATH = "/content/parts/1";

const MARKETING_HTML = `<div><img src="https://tracker.example/hero.png" alt="Hero"><p>Sale ends Sunday.</p></div>`;

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

// The router reads `self` at construction; the shared jsdom globals stop at
// `window`.
(globalThis as { self?: typeof globalThis }).self ??= globalThis;

// The sandboxed frame measures itself once the iframe loads. jsdom fires that
// load but has no ResizeObserver, and the resulting ReferenceError is raised
// inside a listener where no assertion can see it.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

const threadMessage = makeThreadMessage({
	messageId: MESSAGE_ID,
	threadId: THREAD_ID,
	mailboxId: MAILBOX_ID,
	subject: "Sale ends Sunday",
	fromName: "Deals",
	fromEmail: "deals@shop.example",
	category: "marketing",
	isRead: true,
});

const describeMessage = (
	flags: RemitImapAddressFlags,
): RemitImapDescribeMessageResponse =>
	({
		message: {
			messageId: MESSAGE_ID,
			mailboxId: MAILBOX_ID,
			uid: 1,
			rfc822Size: 512,
			internalDate: 1_767_225_600_000,
			status: "active",
			syncStatus: "pending",
		},
		envelope: {
			messageId: MESSAGE_ID,
			date: 1_767_225_600_000,
			subject: "Sale ends Sunday",
			messageIdValue: "<deals-1@shop.example>",
			from: [
				{
					addressId: "addr-deals",
					displayName: "Deals",
					normalizedEmail: "deals@shop.example",
					addressRole: "from",
					addressOrder: 0,
					flags,
				},
			],
			to: [],
			cc: [],
			bcc: [],
			replyTo: [],
			category: "marketing",
			senderTrust: "unknown",
		},
		flags: ["\\Seen"],
		bodyParts: [
			{
				bodyPartId: "part-1",
				mediaType: "TEXT",
				mediaSubtype: "HTML",
				contentUrl: `http://localhost${CONTENT_PATH}`,
				isMultipart: false,
			},
		],
		references: [],
	}) as unknown as RemitImapDescribeMessageResponse;

const testRouter = (): AnyRouter => {
	const rootRoute = createRootRoute({ component: () => createElement(Outlet) });
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
			createElement(MessageCard, {
				threadMessage,
				isExpanded: true,
				onToggle: () => undefined,
				onToggleStar: () => undefined,
			}),
	});
	const routeTree = rootRoute.addChildren([
		mailboxRoute.addChildren([threadRoute.addChildren([messageRoute])]),
	]);
	return createRouter({
		routeTree,
		history: createMemoryHistory({
			initialEntries: [`/mail/${MAILBOX_ID}/${THREAD_ID}/${MESSAGE_ID}`],
		}),
	}) as unknown as AnyRouter;
};

const mount = async (flags: RemitImapAddressFlags): Promise<DomHarness> => {
	http = mockFetch((call) => {
		if (call.path === CONTENT_PATH) {
			return new Response(MARKETING_HTML, {
				status: 200,
				headers: { "content-type": "text/html" },
			});
		}
		if (call.path.endsWith(`/messages/${MESSAGE_ID}`)) {
			return describeMessage(flags);
		}
		// `/config` answers its own shape. `accounts` is required by the contract,
		// so a mock that hands back `{items: []}` for it is a body the API cannot
		// produce, and anything reading it faithfully throws on a fixture rather
		// than on a fault.
		if (call.path.endsWith("/config")) {
			return { accountConfig: {}, accounts: [] };
		}
		return { items: [] };
	});

	const router = testRouter();
	await router.load();
	const dom = createDomHarness();
	harness = dom;
	dom.renderApp(createElement(RouterProvider, { router }));
	await dom.waitFor(
		() => dom.query("iframe") !== null,
		"the message body to render",
	);
	return dom;
};

const frameHtml = (dom: DomHarness): string =>
	dom.query<HTMLIFrameElement>("iframe")?.getAttribute("srcdoc") ?? "";

// A blocked image keeps its original URL in `data-blocked-src`; only a live
// `src=` means the browser will fetch it.
const REMOTE_SRC = /\ssrc="https:\/\/tracker\.example\/hero\.png"/;

const notice = (dom: DomHarness) =>
	dom.query('[data-testid="blocked-images-notice"]');

// A boolean, not the node: an assertion that fails on a jsdom element makes the
// runner serialize the whole tree and the process dies on memory, not on a diff.
const hasTrustedBadge = (dom: DomHarness): boolean =>
	dom.query('[data-testid="trusted-sender-badge"]') !== null;

describe("MessageCard reads flags.blocked on the render path (#352)", () => {
	it("keeps a blocked sender's images out and offers no way to load them", async () => {
		const dom = await mount({ blocked: { value: true, setAt: 1 } });

		assert.doesNotMatch(frameHtml(dom), REMOTE_SRC);
		assert.match(frameHtml(dom), /data-blocked-src/);
		assert.match(notice(dom)?.textContent ?? "", /you blocked this sender/);
		assert.equal(
			dom.queryAll('[data-testid="blocked-images-notice"] button').length,
			0,
			"never load, even on explicit click",
		);
	});

	it("stays blocked when the sender carries both blocked and trusted", async () => {
		const dom = await mount({
			blocked: { value: true, setAt: 1 },
			trusted: { value: true, setAt: 1 },
		});

		assert.doesNotMatch(frameHtml(dom), REMOTE_SRC);
		assert.match(notice(dom)?.textContent ?? "", /you blocked this sender/);
		assert.equal(
			hasTrustedBadge(dom),
			false,
			"a trusted badge beside 'you blocked this sender' tells the user two opposite things",
		);
	});

	it("still auto-loads a trusted sender's images", async () => {
		const dom = await mount({ trusted: { value: true, setAt: 1 } });

		assert.match(frameHtml(dom), REMOTE_SRC);
		assert.equal(notice(dom), null);
		assert.equal(hasTrustedBadge(dom), true);
	});

	it("still offers the load affordances to a merely untrusted sender", async () => {
		const dom = await mount({});

		assert.doesNotMatch(frameHtml(dom), REMOTE_SRC);
		assert.match(notice(dom)?.textContent ?? "", /blocked for privacy/);
		assert.ok(
			dom.queryAll('[data-testid="blocked-images-notice"] button').length > 0,
		);
	});
});
