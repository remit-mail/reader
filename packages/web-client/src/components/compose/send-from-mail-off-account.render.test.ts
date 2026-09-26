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
import { type HttpMock, httpError, mockFetch } from "../../test-support/http";
import { MAIL_OFF_SEND_MESSAGE } from "../settings/account-form-helpers.js";
import { ComposeForm } from "./ComposeForm";
import { ComposeProvider } from "./ComposeProvider";

const ACCOUNT_ID = "acc-1181";
const OUTBOX_MESSAGE_ID = "ob-1181";
const SERVER_REFUSAL =
	"Mail is turned off for this account, so it cannot send. Turn Mail back on for this account in Settings to send from it.";

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

const outboxEntry = {
	outboxMessageId: OUTBOX_MESSAGE_ID,
	accountId: ACCOUNT_ID,
	fromAddress: "me@example.com",
	toAddresses: ["them@example.com"],
	ccAddresses: [],
	bccAddresses: [],
	references: [],
	subject: "Re: Lunch",
	textBody: "yes",
	status: "draft",
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let closed = 0;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	closed = 0;
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

const mount = async (options: {
	syncedServices: string[];
	serverRefusesSend: boolean;
}): Promise<void> => {
	const account = {
		accountId: ACCOUNT_ID,
		email: "me@example.com",
		smtpEnabled: true,
		syncedServices: options.syncedServices,
	} as unknown as RemitImapAccountResponse;

	http = mockFetch(async (call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.path.endsWith("/send") && options.serverRefusesSend) {
			return httpError(400, SERVER_REFUSAL);
		}
		return outboxEntry;
	});

	const Opened = () => {
		const [draftId, setDraftId] = useState<string | undefined>(
			OUTBOX_MESSAGE_ID,
		);
		return createElement(ComposeForm, {
			mode: "reply",
			account,
			sourceMessage,
			outboxMessageId: draftId,
			onDraftCreated: setDraftId,
			onClose: () => {
				closed += 1;
			},
		});
	};

	harness = createDomHarness();
	harness.renderApp(
		createElement(RouterContextProvider, {
			router: testRouter(),
			// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
			children: createElement(ComposeProvider, null, createElement(Opened)),
		}),
	);
	await harness.flush();
	await harness.wait(50);
};

const pressSend = async (): Promise<void> => {
	const button = harness?.byText("button", "Send");
	if (!button) throw new Error("the compose send button is not mounted");
	harness?.click(button);
	await harness?.flush();
	await harness?.wait(100);
};

const sends = (): number =>
	(http?.calls ?? []).filter((call) => call.path.endsWith("/send")).length;

describe("sending from an account with mail off (#1181)", () => {
	it("says why in the composer and sends nothing", async () => {
		await mount({ syncedServices: ["Calendar"], serverRefusesSend: false });

		await pressSend();

		assert.equal(sends(), 0);
		assert.equal(closed, 0);
		assert.ok((harness?.text() ?? "").includes(MAIL_OFF_SEND_MESSAGE));
	});

	it("shows the server's refusal in the composer when the send reaches it", async () => {
		await mount({ syncedServices: ["Mail"], serverRefusesSend: true });

		await pressSend();

		assert.equal(sends(), 1);
		assert.equal(closed, 0);
		assert.ok((harness?.text() ?? "").includes(SERVER_REFUSAL));
	});
});
