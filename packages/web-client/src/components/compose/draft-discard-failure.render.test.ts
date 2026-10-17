import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { __resetFatalError } from "../../lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "../../lib/query-error-handler";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../../test-support/http";
import { ComposeForm } from "./ComposeForm";
import { ComposeProvider } from "./ComposeProvider";

const OUTBOX_MESSAGE_ID = "ob-1";

const account = {
	accountId: "acc-1",
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

const outboxEntry = {
	outboxMessageId: OUTBOX_MESSAGE_ID,
	accountId: account.accountId,
	fromAddress: account.email,
	toAddresses: ["them@example.com"],
	attachments: [],
	ccAddresses: [],
	bccAddresses: [],
	references: [],
	subject: "Fwd: Lunch",
	textBody: "here you go",
	status: "draft",
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	__resetFatalError();
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

it("banners a refused draft discard instead of closing as if it worked", async () => {
	http = mockFetch(async (call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.method === "DELETE") {
			return httpError(409, "the draft is already gone");
		}
		return outboxEntry;
	});

	const queryClient = new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	harness = createDomHarness({ queryClient });
	harness.renderApp(
		createElement(RouterContextProvider, {
			router: testRouter(),
			// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
			children: createElement(
				ComposeProvider,
				null,
				createElement(ComposeForm, {
					mode: "forward",
					account,
					sourceMessage,
					outboxMessageId: OUTBOX_MESSAGE_ID,
					onDraftCreated: () => {},
					onClose: () => {},
				}),
			),
		}),
	);
	await harness.flush();
	await harness.wait(50);

	const discard = harness.query('[aria-label="Discard"]');
	if (!discard) throw new Error("the discard button is not mounted");
	harness.click(discard);
	await harness.flush();
	await harness.wait(100);

	const alerts = harness.queryAll(
		'[aria-label="Notifications"] [role="alert"]',
	);
	assert.equal(alerts.length, 1, "one banner reports the failure");
	assert.match(alerts[0]?.textContent ?? "", /Couldn.t discard draft/);
	assert.match(alerts[0]?.textContent ?? "", /the draft is already gone/);
});
