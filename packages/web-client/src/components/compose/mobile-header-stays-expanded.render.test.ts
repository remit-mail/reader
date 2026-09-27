/**
 * PR #701 review: the phone header collapsed itself again the moment the
 * software keyboard came back up.
 *
 * Tapping the collapsed line blurs whatever had focus, so the keyboard goes
 * down and the rows appear — but only because the keyboard is down. Reaching
 * for To puts it back up, and the header that had reset itself on the way down
 * collapses over the field being typed into: the input unmounts mid-word, the
 * keyboard drops with it, and the rows come back to start the loop again.
 *
 * What is revealed belongs to the document being written, not to the keyboard,
 * so the keyboard going up and down over it changes nothing.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { act, createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, mockFetch } from "../../test-support/http";
import { ComposeForm } from "./ComposeForm";
import { ComposeProvider } from "./ComposeProvider";

const ACCOUNT_ID = "acc-1";
const PHONE = {
	viewportWidth: 390,
	orientation: "portrait",
	pointer: "coarse",
} as const;
/** Shrinkage the hook reads as a software keyboard, with room to spare. */
const KEYBOARD_HEIGHT = 300;

const account = {
	accountId: ACCOUNT_ID,
	email: "me@example.com",
	smtpEnabled: true,
} as unknown as RemitImapAccountResponse;

const sourceMessage = {
	message: { messageId: "msg-1" },
	envelope: {
		subject: "Lunch",
		messageIdValue: "<m1@example.com>",
		from: [{ normalizedEmail: "them@example.com", displayName: "Them" }],
		replyTo: [],
		to: [],
		cc: [],
	},
	references: [],
	bodyParts: [],
} as unknown as RemitImapDescribeMessageResponse;

interface VisualViewportStub {
	height: number;
	addEventListener: (type: string, listener: () => void) => void;
	removeEventListener: (type: string, listener: () => void) => void;
}

const listeners = new Set<() => void>();

const viewport: VisualViewportStub = {
	height: 0,
	addEventListener: (_type, listener) => {
		listeners.add(listener);
	},
	removeEventListener: (_type, listener) => {
		listeners.delete(listener);
	},
};

const setKeyboard = (open: boolean): void => {
	const full = globalThis.window.innerHeight;
	viewport.height = open ? full - KEYBOARD_HEIGHT : full;
	act(() => {
		for (const listener of [...listeners]) listener();
	});
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	listeners.clear();
	Reflect.deleteProperty(globalThis.window, "visualViewport");
});

(globalThis as { self?: typeof globalThis }).self ??= globalThis;

const rootRoute = createRootRoute();
const mailboxRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mail/$mailboxId",
	validateSearch: (search: Record<string, unknown>) => search,
});

const testRouter = (): AnyRouter =>
	createRouter({
		routeTree: rootRoute.addChildren([mailboxRoute]),
		history: createMemoryHistory({ initialEntries: ["/mail/mbx-1"] }),
	}) as unknown as AnyRouter;

const Opened = ({ mode }: { mode: "new" | "reply" }) =>
	createElement(ComposeForm, {
		mode,
		account,
		sourceMessage: mode === "reply" ? sourceMessage : undefined,
		onDraftCreated: () => {},
		onClose: () => {},
	});

const mount = async ({
	mode = "new",
	keyboardOpen = true,
}: {
	mode?: "new" | "reply";
	keyboardOpen?: boolean;
} = {}): Promise<void> => {
	http = mockFetch(async (call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		return { items: [] };
	});

	Object.defineProperty(globalThis.window, "visualViewport", {
		configurable: true,
		value: viewport,
	});
	viewport.height = keyboardOpen
		? globalThis.window.innerHeight - KEYBOARD_HEIGHT
		: globalThis.window.innerHeight;

	harness = createDomHarness(PHONE);
	harness.renderApp(
		createElement(RouterContextProvider, {
			router: testRouter(),
			// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
			children: createElement(
				ComposeProvider,
				null,
				createElement(Opened, { mode }),
			),
		}),
	);
	await harness.flush();
	await harness.wait(50);
};

const collapsedBar = (): HTMLElement | null =>
	harness?.query('[data-testid="compose-header-collapsed"]') ?? null;

const recipientInput = (): HTMLElement | null =>
	harness?.query("#address-field-To") ?? null;

describe("the phone compose header and the software keyboard", () => {
	it("keeps the recipient rows once they are asked for", async () => {
		await mount();

		const collapsed = collapsedBar();
		assert.ok(
			collapsed,
			"the header stands on one line while the keyboard is up",
		);
		assert.equal(recipientInput(), null);

		harness?.click(collapsed);
		await harness?.flush();
		assert.ok(recipientInput(), "the rows came back on the tap");

		// The tap took focus off the body, so the keyboard goes down; reaching for
		// To puts it straight back up.
		setKeyboard(false);
		await harness?.flush();
		setKeyboard(true);
		await harness?.flush();

		assert.ok(
			recipientInput(),
			"the recipient field survived the keyboard coming back",
		);
		assert.equal(
			collapsedBar(),
			null,
			"the header did not collapse over the field being typed into",
		);
	});

	it("keeps To mounted when a reply brings the keyboard up over it", async () => {
		await mount({ mode: "reply", keyboardOpen: false });

		const input = recipientInput();
		assert.ok(input, "the rows are there while the keyboard is down");

		act(() => {
			input.focus();
		});
		setKeyboard(true);
		await harness?.flush();

		assert.equal(
			recipientInput(),
			input,
			"the recipient field stayed mounted under the keyboard",
		);
		assert.equal(
			globalThis.document.activeElement,
			input,
			"the recipient field kept focus",
		);
		assert.equal(
			collapsedBar(),
			null,
			"the header did not collapse over the field being typed into",
		);
	});
});
