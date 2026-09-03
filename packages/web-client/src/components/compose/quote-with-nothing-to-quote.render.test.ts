/**
 * Issue #1030: #1006 refused a send while the quoted original was loading and
 * said so when the fetch failed, but a source that resolved to no renderable
 * part escaped both. The body query never ran, so nothing was loading and
 * nothing had failed — the forward left silently carrying none of the message
 * it forwards.
 *
 * Two routes reach it, and they are opposite states that look alike from the
 * body hook: an attachment-only source (arrived, nothing to quote) and a cold
 * deep link before the source resolves (not arrived yet). Both are asserted
 * here, because reading them as one state either dead-locks Send or restores
 * the silent send.
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
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, mockFetch } from "../../test-support/http";
import { ComposeForm } from "./ComposeForm";
import type { ComposeMode } from "./ComposeProvider";
import { ComposeProvider } from "./ComposeProvider";

const ACCOUNT_ID = "acc-1";

const account = {
	accountId: ACCOUNT_ID,
	email: "me@example.com",
	smtpEnabled: true,
} as unknown as RemitImapAccountResponse;

const envelope = {
	subject: "Scans",
	date: Date.UTC(2026, 5, 24, 9, 14),
	messageIdValue: "<m1@example.com>",
	from: [{ normalizedEmail: "dana@example.com", displayName: "Dana" }],
	replyTo: [],
	to: [{ normalizedEmail: "me@example.com" }],
	cc: [],
};

/**
 * A message whose only part is a PDF. `pickRenderablePart` yields null for it,
 * which is the state the defect hid in.
 */
const attachmentOnlyMessage = {
	message: { messageId: "msg-1" },
	envelope,
	references: [],
	bodyParts: [
		{
			mediaType: "APPLICATION",
			mediaSubtype: "PDF",
			contentUrl: "/content/msg-1/1.pdf",
			isMultipart: false,
			disposition: "attachment",
		},
	],
} as unknown as RemitImapDescribeMessageResponse;

const outboxEntry = () => ({
	outboxMessageId: "ob-1030",
	accountId: ACCOUNT_ID,
	fromAddress: account.email,
	toAddresses: ["dana@example.com"],
	ccAddresses: [],
	bccAddresses: [],
	references: [],
	subject: "Fwd: Scans",
	status: "draft",
});

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

interface MountOptions {
	mode: ComposeMode;
	/** Undefined stands for the describe read that has not landed yet. */
	sourceMessage?: RemitImapDescribeMessageResponse;
}

const mount = async (options: MountOptions): Promise<void> => {
	http = mockFetch(async (call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		return outboxEntry();
	});

	harness = createDomHarness();
	harness.renderApp(
		createElement(RouterContextProvider, {
			router: testRouter(),
			// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
			children: createElement(
				ComposeProvider,
				null,
				createElement(ComposeForm, {
					mode: options.mode,
					account,
					sourceMessage: options.sourceMessage,
					onClose: () => {},
				}),
			),
		}),
	);
	await harness.flush();
	await harness.wait(100);
	await harness.flush();
};

const sendButton = (): HTMLElement => {
	const button = harness?.byText("button", "Send");
	if (!button) throw new Error("the compose send button is not mounted");
	return button;
};

const addRecipient = (email: string): void => {
	const field = harness?.query<HTMLInputElement>("#address-field-To");
	if (!field) throw new Error("the To field is not mounted");
	harness?.type(field, email);
};

const pressSend = async (): Promise<void> => {
	harness?.click(sendButton());
	await harness?.flush();
	await harness?.wait(100);
	await harness?.flush();
};

const dispatched = (): number =>
	(http?.calls ?? []).filter(
		(call) =>
			call.path.endsWith("/send") ||
			(call.method === "POST" && call.path.endsWith("/outbox")),
	).length;

describe("a reply or forward whose source has nothing to quote (#1030)", () => {
	it("refuses to forward a message that resolves to no quotable body", async () => {
		await mount({ mode: "forward", sourceMessage: attachmentOnlyMessage });

		addRecipient("bob@example.com");
		await pressSend();

		assert.equal(
			dispatched(),
			0,
			"a forward carrying none of the message it forwards was dispatched",
		);
		assert.match(harness?.text() ?? "", /no text to forward/);
		assert.match(harness?.text() ?? "", /attachments can't be forwarded/);
	});

	it("says a reply will not carry the message it answers, and still sends it", async () => {
		await mount({ mode: "reply", sourceMessage: attachmentOnlyMessage });

		assert.match(harness?.text() ?? "", /no text to quote/);

		await pressSend();

		assert.ok(
			dispatched() > 0,
			"a reply of the reader's own was refused over a quote it never needed",
		);
	});

	it("refuses to send before the message being quoted has resolved", async () => {
		await mount({ mode: "forward", sourceMessage: undefined });

		addRecipient("bob@example.com");
		await pressSend();

		assert.equal(
			dispatched(),
			0,
			"a forward was dispatched before its source had arrived",
		);
		assert.match(harness?.text() ?? "", /Loading the message you're quoting/);
		assert.doesNotMatch(
			harness?.text() ?? "",
			/no text to forward/,
			"a source still arriving was reported as one holding nothing",
		);
	});
});
