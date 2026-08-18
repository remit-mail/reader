/**
 * Forward opens with a subject and a quote and deliberately no recipient. The
 * autosave gate only skips a form that is blank everywhere, so the seeded
 * subject used to fire a create — and a create carries `@minItems(1)` on
 * `toAddresses`, so the server refused it 400. That refusal then went to the
 * full-screen fatal page, which unmounts the composer and takes the message
 * with it: the one failure mode a composer must never have.
 *
 * Both halves are held here. The invalid request is not made at all while the
 * draft has no recipient to create it with — and the composer says so, because
 * a message being held unsaved in silence is the same loss with the noise taken
 * out. A write that does fail lands in a banner beside the message rather than
 * over it. A 5xx and a 401 keep their own rules.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
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
import { createElement, Fragment, useState } from "react";
import { __resetFatalError } from "../../lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "../../lib/query-error-handler";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../../test-support/http";
import { FatalErrorOverlay } from "../ui/FatalErrorOverlay";
import { ComposeForm } from "./ComposeForm";
import { ComposeProvider } from "./ComposeProvider";

const ACCOUNT_ID = "acc-1";
const OUTBOX_MESSAGE_ID = "ob-fwd";
const AUTOSAVE_DEBOUNCE_MS = 2000;

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

const outboxEntry = () => ({
	outboxMessageId: OUTBOX_MESSAGE_ID,
	accountId: ACCOUNT_ID,
	fromAddress: account.email,
	toAddresses: ["them@example.com"],
	ccAddresses: [],
	bccAddresses: [],
	references: [],
	subject: "Fwd: Lunch",
	textBody: "here you go",
	status: "draft",
});

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	__resetFatalError();
});

const creates = () =>
	(http?.calls ?? []).filter(
		(call) => call.method === "POST" && call.path.endsWith("/outbox"),
	);

const patches = () =>
	(http?.calls ?? []).filter((call) => call.method === "PATCH");

const sends = () =>
	(http?.calls ?? []).filter((call) => call.path.endsWith("/send"));

const fatalOverlay = () =>
	harness?.query('[data-testid="fatal-error-overlay"]') ?? null;

const bannerAlerts = () =>
	harness?.queryAll('[aria-label="Notifications"] [role="alert"]') ?? [];

// The draft the composer is on is its owner's to hand it — here, the test's.
const Opened = ({ outboxMessageId }: { outboxMessageId?: string }) => {
	const [draftId, setDraftId] = useState(outboxMessageId);

	return createElement(ComposeForm, {
		mode: "forward",
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
	/** The draft compose opens on, when the user is resuming one. */
	outboxMessageId?: string;
	/** The status every PATCH answers with, when it is to fail. */
	patchStatus?: number;
}

/**
 * The stub holds the constraint the API holds: a create with no recipient is
 * refused, in the words the backend's schema validation uses.
 */
const mount = async (options: MountOptions = {}): Promise<void> => {
	http = mockFetch(async (call) => {
		if (call.path.endsWith("/config")) return { accounts: [account] };

		if (call.method === "POST" && call.path.endsWith("/outbox")) {
			const to = call.body?.toAddresses;
			if (!Array.isArray(to) || to.length === 0) {
				return httpError(
					400,
					"body/requestBody/toAddresses must NOT have fewer than 1 items",
				);
			}
			return outboxEntry();
		}

		if (call.method === "PATCH") {
			if (options.patchStatus) {
				return httpError(options.patchStatus, "the draft moved on");
			}
			return outboxEntry();
		}

		return outboxEntry();
	});

	const queryClient = new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

	harness = createDomHarness({ queryClient });
	harness.renderApp(
		createElement(
			Fragment,
			null,
			createElement(FatalErrorOverlay),
			createElement(RouterContextProvider, {
				router: testRouter(),
				// biome-ignore lint/correctness/noChildrenProp: RouterContextProvider types `children` as a required prop, which createElement's rest-argument form does not satisfy
				children: createElement(
					ComposeProvider,
					null,
					createElement(Opened, { outboxMessageId: options.outboxMessageId }),
				),
			}),
		),
	);
	await harness.flush();
	await harness.wait(50);
};

const subjectField = (): HTMLInputElement => {
	const field = harness?.query<HTMLInputElement>("[data-subject-field]");
	if (!field) throw new Error("the compose subject field is not mounted");
	return field;
};

const recipientField = (): HTMLInputElement => {
	const field = harness?.query<HTMLInputElement>("#address-field-To");
	if (!field) throw new Error("the compose recipient field is not mounted");
	return field;
};

const addRecipient = async (email: string): Promise<void> => {
	harness?.type(recipientField(), email);
	harness?.dispatch(
		recipientField(),
		new (
			harness.window as unknown as { KeyboardEvent: typeof KeyboardEvent }
		).KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	await harness?.flush();
};

describe("a forwarded message and the draft it cannot create yet", () => {
	it("attempts no create while the forward has no recipient", async () => {
		await mount();

		assert.equal(
			subjectField().value,
			"Fwd: Lunch",
			"the forward seeded its subject, so the form is not blank",
		);

		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 300);

		assert.equal(creates().length, 0, "no create was attempted");
		assert.equal(fatalOverlay(), null, "the composer stayed on screen");
		assert.equal(bannerAlerts().length, 0, "nothing was raised as a failure");
	});

	it("says the draft is not being saved, and what would make it save", async () => {
		await mount();

		harness?.type(subjectField(), "Fwd: Lunch and the three paragraphs after");
		await harness?.flush();

		const indicator = harness?.byText("output", "Not saved");
		assert.match(
			indicator?.textContent ?? "",
			/add a To address/i,
			"the composer names the field the create schema actually requires",
		);

		await addRecipient("them@example.com");
		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 300);

		assert.equal(creates().length, 1, "the held content was written");
		assert.equal(
			creates()[0]?.body?.subject,
			"Fwd: Lunch and the three paragraphs after",
			"including everything typed while it was held",
		);
		assert.match(harness?.text() ?? "", /Draft saved/);
	});

	it("creates the draft, with everything the forward seeded, once a recipient is there", async () => {
		await mount();
		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 300);

		await addRecipient("them@example.com");
		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 300);

		const created = creates();
		assert.equal(created.length, 1, "the draft was created once");
		assert.deepEqual(created[0]?.body?.toAddresses, ["them@example.com"]);
		assert.equal(created[0]?.body?.subject, "Fwd: Lunch");
		assert.equal(fatalOverlay(), null, "the composer stayed on screen");
	});

	it("refuses to send a forward that has no recipient, and says why", async () => {
		await mount();

		const send = harness?.byText("button", "Send");
		if (!send) throw new Error("the send button is not mounted");
		harness?.click(send);
		await harness?.flush();
		await harness?.wait(100);

		assert.match(harness?.text() ?? "", /Add a To address before sending/);
		assert.equal(creates().length, 0, "nothing was created");
		assert.equal(sends().length, 0, "nothing was sent");
	});

	it("drops the held sentence the moment the To address arrives", async () => {
		await mount();

		harness?.type(subjectField(), "Fwd: Lunch and the three paragraphs after");
		await harness?.flush();
		assert.match(harness?.text() ?? "", /Not saved/);

		await addRecipient("them@example.com");

		// Before the debounce, not after it: the sentence stopped being true the
		// moment the address landed, and standing for another two seconds tells
		// the user their draft is being dropped when it is on its way.
		assert.doesNotMatch(
			harness?.text() ?? "",
			/Not saved/,
			"a reason that no longer holds is off screen at once",
		);
	});
});

describe("a failed autosave and the message it is holding", () => {
	it("banners a refused write and leaves the composer and its text alone", async () => {
		await mount({ outboxMessageId: OUTBOX_MESSAGE_ID, patchStatus: 409 });

		harness?.type(subjectField(), "Fwd: Lunch on Thursday");
		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 300);

		assert.ok(patches().length > 0, "the write was attempted");
		assert.equal(
			fatalOverlay(),
			null,
			"a refused autosave must not take the composer down",
		);
		assert.match(harness?.text() ?? "", /Couldn't save draft/);
		assert.equal(
			subjectField().value,
			"Fwd: Lunch on Thursday",
			"what was written is still on screen",
		);
	});

	it("escalates a 401 — a dismissible banner is no way back in", async () => {
		await mount({ outboxMessageId: OUTBOX_MESSAGE_ID, patchStatus: 401 });

		harness?.type(subjectField(), "Fwd: Lunch on Thursday");
		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 300);

		assert.ok(
			fatalOverlay(),
			"a signed-out session must reach the page that signs back in",
		);
	});

	it("still escalates a 5xx from the same write", async () => {
		await mount({ outboxMessageId: OUTBOX_MESSAGE_ID, patchStatus: 500 });

		harness?.type(subjectField(), "Fwd: Lunch on Thursday");
		await harness?.wait(AUTOSAVE_DEBOUNCE_MS + 300);

		assert.ok(fatalOverlay(), "our API answering 'I'm broken' is never soft");
	});
});
