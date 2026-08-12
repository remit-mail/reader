/**
 * Compose pressed while already composing starts a new message (#719).
 *
 * The compose route carries the draft as an optional segment, so pressing
 * Compose from inside the composer drops that segment and leaves the same route
 * matched — nothing remounts the form. The reset effect used to bail whenever
 * the incoming id was absent, so the previous draft's recipients, subject and
 * body stayed on screen under an address that said new message, and the next
 * autosave took the create branch and wrote a SECOND draft holding the first
 * one's content.
 *
 * Two properties, one cause: what is on screen, and what is written. The write
 * is the damaging half — the duplicate outlives the session, in the reader's
 * drafts.
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
const DRAFT_ID = "ob-first";
const AUTOSAVE_DEBOUNCE_MS = 2000;

const account = {
	accountId: ACCOUNT_ID,
	email: "me@example.com",
	smtpEnabled: true,
} as unknown as RemitImapAccountResponse;

const draft = {
	outboxMessageId: DRAFT_ID,
	accountId: ACCOUNT_ID,
	fromAddress: account.email,
	toAddresses: ["them@example.com"],
	ccAddresses: [],
	bccAddresses: [],
	references: [],
	subject: "Lunch on Thursday",
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
 * The composer with its draft handed in, and a button that takes it away again
 * — which is what pressing Compose does to the address it is mounted under.
 */
const Composer = () => {
	const [draftId, setDraftId] = useState<string | undefined>(DRAFT_ID);

	return createElement(
		"div",
		null,
		createElement(
			"button",
			{ type: "button", onClick: () => setDraftId(undefined) },
			"Compose",
		),
		createElement(ComposeForm, {
			mode: "new",
			account,
			outboxMessageId: draftId,
			onDraftCreated: setDraftId,
			onClose: () => undefined,
		}),
	);
};

const creates = () =>
	(http?.calls ?? []).filter(
		(call) => call.method === "POST" && call.path.endsWith("/outbox"),
	);

const mount = async (): Promise<DomHarness> => {
	http = mockFetch(async (call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };
		if (call.method === "POST" && call.path.endsWith("/outbox"))
			return { ...draft, outboxMessageId: "ob-second" };
		return draft;
	});

	const created = createDomHarness();
	harness = created;
	created.renderApp(
		createElement(RouterContextProvider, {
			router: testRouter(),
			// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
			children: createElement(ComposeProvider, null, createElement(Composer)),
		}),
	);
	await created.flush();
	await created.wait(50);
	return created;
};

const subjectField = (mounted: DomHarness): HTMLInputElement => {
	const field = mounted.query<HTMLInputElement>("[data-subject-field]");
	if (!field) throw new Error("the composer has no subject field");
	return field;
};

describe("Compose pressed while already composing", () => {
	it("takes the previous draft's message off the screen", async () => {
		const mounted = await mount();
		assert.equal(subjectField(mounted).value, draft.subject);
		assert.match(mounted.text(), /them@example.com/);

		mounted.click(mounted.byText("button", "Compose"));
		await mounted.flush();
		await mounted.wait(20);

		assert.equal(subjectField(mounted).value, "");
		assert.doesNotMatch(mounted.text(), /them@example.com/);
	});

	// The half that outlives the session: an autosave from a form still holding
	// the old content, with no draft to write it to, creates a second one.
	it("writes no second draft carrying the first one's content", async () => {
		const mounted = await mount();
		assert.equal(subjectField(mounted).value, draft.subject);

		mounted.click(mounted.byText("button", "Compose"));
		await mounted.flush();
		await mounted.wait(AUTOSAVE_DEBOUNCE_MS + 500);

		assert.deepEqual(
			creates().map((call) => call.body?.subject),
			[],
			"a blank new message has nothing to save, so nothing was written",
		);
	});
});
