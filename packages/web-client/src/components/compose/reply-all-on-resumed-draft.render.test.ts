/**
 * Issue #796: Reply All does nothing on a reply reopened after a reload.
 *
 * The composer mounts holding a draft id, so `resumedDraftRef` starts true —
 * the guard that keeps a saved draft's recipients from being overwritten when
 * it reopens. But that same guard then swallowed every later run of the
 * seeding effect, so switching the mode to Reply All over the same message
 * rewrote nothing: no addresses in Cc, nothing changed on screen. A dead
 * control — the reader cannot tell whether Reply All is broken, misconfigured,
 * or their own mistake.
 *
 * The guarantees here: a resumed reply still opens untouched, but pressing
 * Reply All puts the source message's other recipients in Cc.
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
import { createElement, useState } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, mockFetch } from "../../test-support/http";
import { ComposeForm } from "./ComposeForm";
import { ComposeProvider } from "./ComposeProvider";

const ACCOUNT_ID = "acc-1";
const DRAFT_ID = "ob-796";

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
		to: [{ normalizedEmail: "other@example.com", displayName: "Other" }],
		cc: [{ normalizedEmail: "copied@example.com", displayName: "Copied" }],
	},
	references: [],
	bodyParts: [],
} as unknown as RemitImapDescribeMessageResponse;

/** The draft as it was saved under Reply: only To holds the sender. */
const draft = {
	outboxMessageId: DRAFT_ID,
	accountId: ACCOUNT_ID,
	fromAddress: account.email,
	toAddresses: ["them@example.com"],
	ccAddresses: [],
	bccAddresses: [],
	references: [],
	subject: "Re: Lunch",
	textBody: "Does one o'clock work?",
	status: "draft",
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
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

/**
 * The composer reopened on its saved draft, with a button standing in for the
 * mode control — which switches Reply over to Reply All without remounting the
 * form or changing the draft segment.
 */
const Reopened = () => {
	const [mode, setMode] = useState<"reply" | "reply-all">("reply");

	return createElement(
		"div",
		null,
		createElement(
			"button",
			{ type: "button", onClick: () => setMode("reply-all") },
			"Reply All",
		),
		createElement(ComposeForm, {
			mode,
			account,
			sourceMessage,
			outboxMessageId: DRAFT_ID,
			onDraftCreated: () => undefined,
			onClose: () => undefined,
		}),
	);
};

const mount = async (): Promise<DomHarness> => {
	http = mockFetch(async (call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		return draft;
	});

	const created = createDomHarness();
	harness = created;
	created.renderApp(
		createElement(RouterContextProvider, {
			router: testRouter(),
			// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
			children: createElement(ComposeProvider, null, createElement(Reopened)),
		}),
	);
	await created.flush();
	await created.wait(50);
	return created;
};

describe("Reply All on a resumed reply", () => {
	it("keeps the saved draft's fields while it merely reopens", async () => {
		const mounted = await mount();
		assert.match(mounted.text(), /them@example.com/);
		assert.doesNotMatch(
			mounted.text(),
			/Copied|copied@example\.com/,
			"reopening must not rewrite what the reader saved",
		);
	});

	it("puts the source message's other recipients in Cc", async () => {
		const mounted = await mount();

		mounted.click(mounted.byText("button", "Reply All"));
		await mounted.flush();
		await mounted.wait(20);

		// The address field renders the envelope's display names.
		assert.match(mounted.text(), /OtherCopied|copied@example\.com/);
	});
});
