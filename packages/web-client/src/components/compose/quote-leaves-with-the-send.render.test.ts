/**
 * Issue #845.5: the composer showed the quoted original under the editor the
 * whole time a reply or a forward was being written, and sent neither. A
 * forward left carrying the signature and nothing else.
 *
 * Asserted here on the request, because the request is what the recipient gets:
 * the body compose writes before it dispatches has to hold the message on
 * screen. Send is also refused while that message is still being fetched — a
 * press landing in that window is the same empty forward with the timing
 * changed.
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
import type { ComposeMode } from "./ComposeProvider";
import { ComposeProvider } from "./ComposeProvider";

const ACCOUNT_ID = "acc-1";
const BODY_URL = "/content/msg-1/body.txt";
const ORIGINAL = "Are we still on for Thursday?\n\nI can do 12:30.";

const account = {
	accountId: ACCOUNT_ID,
	email: "me@example.com",
	smtpEnabled: true,
} as unknown as RemitImapAccountResponse;

const sourceMessage = {
	message: { messageId: "msg-1" },
	envelope: {
		subject: "Lunch",
		date: Date.UTC(2026, 5, 24, 9, 14),
		messageIdValue: "<m1@example.com>",
		from: [{ normalizedEmail: "dana@example.com", displayName: "Dana" }],
		replyTo: [],
		to: [{ normalizedEmail: "me@example.com" }],
		cc: [],
	},
	references: [],
	bodyParts: [
		{
			mediaType: "TEXT",
			mediaSubtype: "PLAIN",
			contentUrl: BODY_URL,
			isMultipart: false,
		},
	],
} as unknown as RemitImapDescribeMessageResponse;

const outboxEntry = () => ({
	outboxMessageId: "ob-845",
	accountId: ACCOUNT_ID,
	fromAddress: account.email,
	toAddresses: ["dana@example.com"],
	ccAddresses: [],
	bccAddresses: [],
	references: [],
	subject: "Re: Lunch",
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

const Opened = ({ mode }: { mode: ComposeMode }) => {
	const [draftId, setDraftId] = useState<string | undefined>(undefined);

	return createElement(ComposeForm, {
		mode,
		account,
		sourceMessage,
		outboxMessageId: draftId,
		onDraftCreated: setDraftId,
		onClose: () => {},
	});
};

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
	/** Hold the quoted body's fetch open, so Send is pressed without it. */
	gateBody?: boolean;
}

const mount = async (
	options: MountOptions,
): Promise<{ releaseBody: () => void }> => {
	let release = (): void => {};
	const bodyGate = options.gateBody
		? new Promise<void>((resolve) => {
				release = resolve;
			})
		: Promise.resolve();

	http = mockFetch(async (call) => {
		if (call.path === BODY_URL) {
			await bodyGate;
			return new Response(ORIGINAL, {
				status: 200,
				headers: { "content-type": "text/plain" },
			});
		}
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
				createElement(Opened, { mode: options.mode }),
			),
		}),
	);
	await harness.flush();
	await harness.wait(100);
	await harness.flush();

	return { releaseBody: release };
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

const written = (): Record<string, unknown> => {
	const body = (http?.calls ?? []).find(
		(call) =>
			(call.method === "POST" && call.path.endsWith("/outbox")) ||
			call.method === "PATCH",
	)?.body;
	if (!body) throw new Error("nothing was written for the send");
	return body;
};

describe("the message a reply and a forward leave with (#845.5)", () => {
	it("sends a reply carrying the message it answers", async () => {
		await mount({ mode: "reply" });

		harness?.click(sendButton());
		await harness?.flush();
		await harness?.wait(100);

		const body = written();
		assert.match(String(body.textBody), /^On .+ Dana .+ wrote:$/m);
		assert.match(String(body.textBody), /^> Are we still on for Thursday\?$/m);
		assert.match(String(body.htmlBody), /<blockquote type="cite">/);
		assert.match(String(body.htmlBody), /Are we still on for Thursday\?/);
	});

	it("sends a forward carrying the message it forwards", async () => {
		await mount({ mode: "forward" });

		addRecipient("bob@example.com");
		harness?.click(sendButton());
		await harness?.flush();
		await harness?.wait(100);

		const body = written();
		assert.match(String(body.textBody), /-+ Forwarded message -+/);
		assert.match(String(body.textBody), /^Subject: Lunch$/m);
		assert.match(String(body.textBody), /Are we still on for Thursday\?/);
		assert.match(String(body.htmlBody), /Forwarded message/);
		assert.match(String(body.htmlBody), /Are we still on for Thursday\?/);
	});

	it("refuses to send while the message being quoted is still loading", async () => {
		const { releaseBody } = await mount({ mode: "reply", gateBody: true });

		harness?.click(sendButton());
		await harness?.flush();
		await harness?.wait(50);

		assert.equal(
			(http?.calls ?? []).filter((call) => call.path.endsWith("/send")).length,
			0,
			"nothing was dispatched without the message it quotes",
		);
		assert.match(harness?.text() ?? "", /Loading the message you're quoting/);

		releaseBody();
		await harness?.flush();
		await harness?.wait(50);
	});
});
