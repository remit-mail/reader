/**
 * Issue #933: opening a message is not editing it.
 *
 * Editing a settled failure returns the row to `draft`, which is what gets a
 * message refused for a bad address back on its way. The composer's autosave
 * had no dirty check, though, and its effect runs on the render that fills the
 * fields from the server's copy — so opening a Failed message and pressing
 * Escape wrote a PATCH, and the row left the Outbox with the reader having
 * changed nothing. A status change nobody asked for, on a message they were
 * only reading.
 *
 * The rule pinned here: an untouched document writes nothing, and the first
 * real edit writes as it always did.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
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
const OUTBOX_MESSAGE_ID = "ob-933";
const AUTOSAVE_DEBOUNCE_MS = 2000;

const account = {
	accountId: ACCOUNT_ID,
	email: "me@example.com",
	smtpEnabled: true,
} as unknown as RemitImapAccountResponse;

/** The row as the Outbox holds it: refused, and still carrying what was typed. */
const failedEntry = {
	outboxMessageId: OUTBOX_MESSAGE_ID,
	accountId: ACCOUNT_ID,
	fromAddress: account.email,
	toAddresses: ["typo@exmaple.com"],
	ccAddresses: [],
	bccAddresses: [],
	references: [],
	subject: "Invoice",
	textBody: "Attached.",
	status: "failed",
	lastError: "550 5.1.0 mailbox unavailable",
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

const Opened = () => {
	const [draftId, setDraftId] = useState<string | undefined>(OUTBOX_MESSAGE_ID);

	return createElement(ComposeForm, {
		mode: "new",
		account,
		outboxMessageId: draftId,
		onDraftCreated: setDraftId,
		onClose: () => undefined,
	});
};

const writes = () =>
	(http?.calls ?? []).filter(
		(call) => call.method === "PATCH" || call.method === "POST",
	);

const mount = async (): Promise<void> => {
	http = mockFetch(async (call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		return failedEntry;
	});

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

const subjectField = (): HTMLElement => {
	const field = harness?.query("[data-subject-field]");
	if (!field) throw new Error("the compose subject field is not mounted");
	return field;
};

describe("a message reopened in the composer", () => {
	it("writes nothing while nobody has touched it", async () => {
		await mount();

		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 200);

		assert.deepEqual(
			writes().map((call) => call.method),
			[],
			"reopening a message must not change it",
		);
	});

	it("writes the first real edit", async () => {
		await mount();

		harness?.type(subjectField(), "Invoice, corrected");
		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 200);

		const written = writes().at(-1);
		assert.equal(written?.method, "PATCH");
		assert.equal(written?.body?.subject, "Invoice, corrected");
	});
});
