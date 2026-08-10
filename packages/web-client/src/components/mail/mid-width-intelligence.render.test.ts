/**
 * The authenticity warning's "Why?" between 1024 and 1280px.
 *
 * At that width the shell mounts the reading pane but has no room for the
 * intelligence rail, and the desktop path had no other surface to put it on:
 * the link flipped a flag and nothing appeared. A dead control is worse than a
 * missing one — the reader cannot tell whether the app is broken, the account
 * misconfigured, or the click missed.
 *
 * The drawer is also not the rail's preference made visible. `intelligenceOpen`
 * is persisted and the DKIM auto-open sets it on every tier, so a drawer driven
 * by it would throw a scrim over the message the moment one was selected. It
 * opens when it is asked for and not before, which is what the first assertion
 * of each case pins.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapDescribeMessageResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { AppShellSlotted } from "@remit/ui";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { createElement, useState } from "react";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { MailContext, type MailContextValue } from "@/lib/mail-context";
import { EMPTY_RESULT_FOLDER_INDEX } from "@/lib/result-folder";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import {
	makeAccount,
	makeMailbox,
	makeThreadMessage,
} from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { MailboxPane } from "./MailboxPane";

/** Inside the band where the reading pane is up and the rail is not. */
const TWO_PANE_WIDTH = 1100;

const ACCOUNT_ID = "acc-1";
const MAILBOX_ID = "mbx-inbox";
const THREAD_ID = "thread-1";
const MESSAGE_ID = "msg-1";

const account = makeAccount({ accountId: ACCOUNT_ID });
const mailbox = makeMailbox({
	mailboxId: MAILBOX_ID,
	fullPath: "INBOX",
	accountId: ACCOUNT_ID,
});

const phishingThread: RemitImapThreadMessageResponse = makeThreadMessage({
	messageId: MESSAGE_ID,
	threadId: THREAD_ID,
	mailboxId: MAILBOX_ID,
	accountId: ACCOUNT_ID,
	subject: "Your parcel could not be delivered",
	fromName: "Mondial Relay",
	fromEmail: "notice@mondialrelay.example",
	isRead: true,
	authenticity: {
		fromDomain: "mondialrelay.example",
		dkimDomain: "gmail.example",
		dkimMismatch: true,
	},
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
		subject: "Your parcel could not be delivered",
		messageIdValue: "<notice-1@gmail.example>",
		from: [
			{
				addressId: "addr-sender",
				displayName: "Mondial Relay",
				normalizedEmail: "notice@mondialrelay.example",
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

const mailContext = (
	intelligenceOpen: boolean,
	setIntelligenceOpen: (open: boolean) => void,
): MailContextValue => ({
	accounts: [account],
	mailboxNameIndex: new Map(),
	accountNameIndex: new Map(),
	resultFolderIndex: EMPTY_RESULT_FOLDER_INDEX,
	searchQuery: "",
	searchInput: "",
	searchViewKey: "",
	onSearchChange: () => {},
	onSearchClear: () => {},
	onSearchClearQuery: () => {},
	intelligenceOpen,
	onToggleIntelligence: () => setIntelligenceOpen(!intelligenceOpen),
	onSetIntelligenceOpen: setIntelligenceOpen,
});

/**
 * The mailbox as the route mounts it — the same provider, the same shell, the
 * same slots — framed at a container width the rail does not fit in.
 */
const TwoPaneMailbox = () => {
	const [intelligenceOpen, setIntelligenceOpen] = useState(false);
	return createElement(
		MailContext.Provider,
		{ value: mailContext(intelligenceOpen, setIntelligenceOpen) },
		createElement(MailboxPane, {
			mailboxId: MAILBOX_ID,
			selectedMessageId: MESSAGE_ID,
			// biome-ignore lint/correctness/noChildrenProp: no JSX in a .test.ts, and createElement's typed overload wants a required `children` in the props object
			children: createElement(AppShellSlotted, {
				initialWidth: TWO_PANE_WIDTH,
				nav: createElement("div"),
				list: createElement("div"),
				reading: createElement(MailboxPane.Reading),
				intelligence: createElement(MailboxPane.Intelligence),
				intelligenceOpen,
				hasThread: true,
			}),
		}),
	);
};

const testRouter = (): AnyRouter => {
	const rootRoute = createRootRoute({
		component: () =>
			createElement(ComposeProvider, null, createElement(Outlet)),
	});
	const routeTree = rootRoute.addChildren([
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/mail/$mailboxId",
			validateSearch: (search: Record<string, unknown>) => search,
			component: TwoPaneMailbox,
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
		if (call.path.endsWith(`/accounts/${ACCOUNT_ID}/mailboxes`)) {
			return { items: [mailbox] };
		}
		if (call.path.endsWith(`/mailboxes/${MAILBOX_ID}/threads`)) {
			return { items: [phishingThread] };
		}
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: [phishingThread] };
		}
		if (call.path.endsWith(`/messages/${MESSAGE_ID}`)) return describeMessage;
		return { items: [] };
	});

	const router = testRouter();
	await router.load();
	// Landscape, fine pointer: the posture half of the desktop rule, so the app
	// takes its desktop path and the width alone decides the pane count.
	harness = createDomHarness({
		viewportWidth: TWO_PANE_WIDTH,
		orientation: "landscape",
		pointer: "fine",
	});
	harness.renderApp(createElement(RouterProvider, { router }));
	await harness.flush();
	await harness.wait(20);
	await harness.flush();
	return harness;
};

const intelligenceSurface = (mounted: DomHarness): HTMLElement | null =>
	mounted.query('[role="dialog"][aria-label="Message details"]');

describe("the authenticity warning's Why? on a two-pane desktop (1024–1280px)", () => {
	it("opens the intelligence panel the link promises", async () => {
		const mounted = await mount();

		assert.ok(
			mounted.text().includes("claims to be from"),
			"the authenticity banner is on screen",
		);
		assert.equal(
			intelligenceSurface(mounted),
			null,
			"nothing is open before the reader asks for it",
		);

		mounted.click(mounted.byText("button", "Why?"));
		await mounted.flush();
		await mounted.wait(20);
		await mounted.flush();

		const surface = intelligenceSurface(mounted);
		assert.ok(surface, "the link lands on a real intelligence surface");
		assert.ok(
			(surface.textContent ?? "").includes("Intelligence"),
			"the surface carries the intelligence panel, not an empty shell",
		);
	});

	it("goes away again when it is dismissed", async () => {
		const mounted = await mount();

		mounted.click(mounted.byText("button", "Why?"));
		await mounted.flush();
		assert.ok(intelligenceSurface(mounted), "the panel opened");

		mounted.click(mounted.byLabel("Close menu"));
		await mounted.flush();

		assert.equal(
			intelligenceSurface(mounted),
			null,
			"the reader can put the panel away",
		);
	});
});
