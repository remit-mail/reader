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
 * Reply All puts the source message's other recipients in Cc — including when
 * the press lands before the source message or the account has resolved, which
 * after a reload is the ordinary case rather than the exception.
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

/** The reader is among the message's recipients, as they are on their own mail. */
const sourceMessage = {
	message: { messageId: "msg-1", mailboxId: "mbx-1" },
	envelope: {
		subject: "Lunch",
		messageIdValue: "<m1@example.com>",
		from: [{ normalizedEmail: "them@example.com", displayName: "Them" }],
		replyTo: [],
		to: [
			{ normalizedEmail: "other@example.com", displayName: "Other" },
			{ normalizedEmail: account.email, displayName: "Me" },
		],
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

interface ReopenedProps {
	/** A reload refetches the source, which lands after the form is on screen. */
	sourceAtMount: boolean;
	/** The account is looked up from the source's mailbox, so it lands later still. */
	accountAtMount: boolean;
}

/**
 * The composer reopened on its saved draft, with a button standing in for the
 * mode control — which switches Reply over to Reply All without remounting the
 * form or changing the draft segment. The two other buttons stand in for the
 * fetches a reload leaves outstanding, so a test can put the press before them.
 */
const Reopened = ({ sourceAtMount, accountAtMount }: ReopenedProps) => {
	const [mode, setMode] = useState<"reply" | "reply-all">("reply");
	const [source, setSource] = useState(
		sourceAtMount ? sourceMessage : undefined,
	);
	const [resolved, setResolved] = useState(
		accountAtMount ? account : undefined,
	);

	return createElement(
		"div",
		null,
		createElement(
			"button",
			{ type: "button", onClick: () => setMode("reply-all") },
			"Reply All",
		),
		createElement(
			"button",
			{ type: "button", onClick: () => setSource(sourceMessage) },
			"Deliver source",
		),
		createElement(
			"button",
			{ type: "button", onClick: () => setResolved(account) },
			"Resolve account",
		),
		createElement(ComposeForm, {
			mode,
			account: resolved,
			sourceMessage: source,
			outboxMessageId: DRAFT_ID,
			onDraftCreated: () => undefined,
			onClose: () => undefined,
		}),
	);
};

const mount = async (props: ReopenedProps): Promise<DomHarness> => {
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
			children: createElement(
				ComposeProvider,
				null,
				createElement(Reopened, props),
			),
		}),
	);
	await created.flush();
	await created.wait(50);
	return created;
};

const press = async (mounted: DomHarness, label: string): Promise<void> => {
	mounted.click(mounted.byText("button", label));
	await mounted.flush();
	await mounted.wait(20);
};

/**
 * What one address field holds, read off the chips rather than off the form's
 * text: every recipient is one chip, and each carries its address whether or
 * not the envelope gave it a display name.
 */
const addressesIn = (mounted: DomHarness, label: string): string[] =>
	mounted
		.queryAll(`[data-address-field="${label}"] [aria-label^="Remove "]`)
		.map((chip) =>
			(chip.getAttribute("aria-label") ?? "").replace("Remove ", ""),
		);

describe("Reply All on a resumed reply", () => {
	it("keeps the saved draft's fields while it merely reopens", async () => {
		const mounted = await mount({ sourceAtMount: true, accountAtMount: true });

		assert.deepEqual(addressesIn(mounted, "To"), ["them@example.com"]);
		assert.deepEqual(
			addressesIn(mounted, "Cc"),
			[],
			"reopening must not rewrite what the reader saved",
		);
	});

	it("puts the source message's other recipients in Cc", async () => {
		const mounted = await mount({ sourceAtMount: true, accountAtMount: true });

		await press(mounted, "Reply All");

		assert.deepEqual(addressesIn(mounted, "Cc"), [
			"other@example.com",
			"copied@example.com",
		]);
	});

	// After a reload the source is fetched fresh, so the press ordinarily comes
	// first. Reading the mode off that run recorded "reply-all" as the mode the
	// draft opened under, and Cc stayed empty — the original dead control.
	it("seeds Cc when the press lands before the source message", async () => {
		const mounted = await mount({ sourceAtMount: false, accountAtMount: true });

		await press(mounted, "Reply All");
		await press(mounted, "Deliver source");

		assert.deepEqual(addressesIn(mounted, "Cc"), [
			"other@example.com",
			"copied@example.com",
		]);
	});

	// The account is looked up from the source's mailbox, so it resolves after
	// the source. Its address is the only thing that keeps the reader out of the
	// Cc of their own reply (#819), so a seed made without it is made again.
	it("takes the reader out of Cc when the account resolves after the press", async () => {
		const mounted = await mount({ sourceAtMount: true, accountAtMount: false });

		await press(mounted, "Reply All");
		await press(mounted, "Resolve account");

		assert.deepEqual(addressesIn(mounted, "Cc"), [
			"other@example.com",
			"copied@example.com",
		]);
	});
});
