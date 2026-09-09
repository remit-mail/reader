/**
 * Issue #1030: a source with no text or html part — a message that is
 * attachments and nothing else — left the quote hook disabled, so nothing was
 * loading, nothing had failed, and the composer sent a forward carrying none of
 * the original at all.
 *
 * The composer sends a text body and an html body and no attachments, so that
 * forward has nothing to arrive with: it is refused, in words. A reply still
 * carries the answer and the thread's references, so it goes out and says the
 * original is not quoted in it. And a source that has not arrived yet is a
 * third thing again — still loading, not a message with nothing in it.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { NO_QUOTABLE_BODY_FORWARD_MESSAGE } from "@remit/ui";
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

const account = {
	accountId: ACCOUNT_ID,
	email: "me@example.com",
	smtpEnabled: true,
} as unknown as RemitImapAccountResponse;

/** Two scans and a cover sheet — no text part anywhere in it. */
const attachmentOnlySource = {
	message: { messageId: "msg-1" },
	envelope: {
		subject: "Scans",
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
			mediaType: "MULTIPART",
			mediaSubtype: "MIXED",
			contentUrl: "",
			isMultipart: true,
		},
		{
			mediaType: "IMAGE",
			mediaSubtype: "JPEG",
			disposition: "attachment",
			contentUrl: "/content/msg-1/2.jpg",
			isMultipart: false,
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

const Opened = ({
	mode,
	sourceMessage,
}: {
	mode: ComposeMode;
	sourceMessage?: RemitImapDescribeMessageResponse;
}) => {
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

const mount = async (options: {
	mode: ComposeMode;
	/** Left out for the deep link that opened before the source landed. */
	sourceMessage?: RemitImapDescribeMessageResponse;
}): Promise<void> => {
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
				createElement(Opened, {
					mode: options.mode,
					sourceMessage: options.sourceMessage,
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

const dispatches = (): number =>
	(http?.calls ?? []).filter((call) => call.path.endsWith("/send")).length;

const press = async (): Promise<void> => {
	harness?.click(sendButton());
	await harness?.flush();
	await harness?.wait(100);
};

describe("a source with nothing to quote (#1030)", () => {
	it("refuses a forward of a message that is attachments only", async () => {
		await mount({ mode: "forward", sourceMessage: attachmentOnlySource });

		addRecipient("bob@example.com");
		await press();

		assert.equal(
			dispatches(),
			0,
			"a forward left with nothing of the message it forwards",
		);
		assert.ok(
			(harness?.text() ?? "").includes(NO_QUOTABLE_BODY_FORWARD_MESSAGE),
			"the refusal was not stated",
		);
	});

	it("says so on screen before the forward is even written", async () => {
		await mount({ mode: "forward", sourceMessage: attachmentOnlySource });

		const banner = harness?.query("[data-testid=compose-quote-missing]");
		assert.ok(banner, "nothing said the message had no body to quote");
	});

	it("sends a reply to it, saying the original is not quoted", async () => {
		await mount({ mode: "reply", sourceMessage: attachmentOnlySource });

		assert.ok(
			harness?.query("[data-testid=compose-quote-missing]"),
			"nothing said the original would not be quoted",
		);

		await press();

		assert.equal(dispatches(), 1, "the reply was not sent");
	});

	it("refuses while the source is still on its way, without claiming it is empty", async () => {
		await mount({ mode: "forward" });

		addRecipient("bob@example.com");
		await press();

		assert.equal(dispatches(), 0, "a forward left before its source arrived");
		assert.match(harness?.text() ?? "", /Loading the message you're quoting/);
		assert.equal(
			harness?.query("[data-testid=compose-quote-missing]"),
			null,
			"a source still arriving was reported as a message with no body",
		);
	});
});
