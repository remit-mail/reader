/**
 * The reading-pane notice names the mutation that gave up and offers the way
 * out for that one (#1229).
 *
 * A delete retries through the ordinary delete endpoint. A move cannot — the
 * destination the give-up discarded is on no row — so its retry is the folder
 * picker, which needs an account to scope its list to. The caller's `accountId`
 * is absent on rows from per-mailbox endpoints and for as long as the
 * conversation's own lookup is in flight, and a notice that names a failure and
 * then offers nothing is the same dead end as one that offers the wrong thing.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, mockFetch } from "../../test-support/http";
import { ErrorBannerProvider } from "../ui/ErrorBannerProvider";
import { MessageSettlementAlert } from "./MessageSettlementAlert";
import { RoleAppointmentPromptProvider } from "./RoleAppointmentPromptProvider";

const ACCOUNT = "acc-1";
const MAILBOX = "mbx-inbox";

let harness: DomHarness | undefined;
let http: HttpMock;

const CONFIG = {
	accounts: [{ accountId: ACCOUNT, email: "a@example.com" }],
};

const MAILBOXES = {
	items: [
		{
			mailboxId: MAILBOX,
			accountId: ACCOUNT,
			fullPath: "INBOX",
			hierarchyDelimiter: "/",
			messageCount: 1,
		},
	],
};

const respond = (path: string): unknown => {
	if (path.endsWith("/config")) return CONFIG;
	if (path.endsWith("/mailboxes")) return MAILBOXES;
	return {};
};

const thread = (
	over: Partial<RemitImapThreadMessageResponse>,
): RemitImapThreadMessageResponse =>
	({
		threadMessageId: "tm-1",
		threadId: "th-1",
		messageId: "msg-1",
		accountConfigId: "cfg-1",
		mailboxId: MAILBOX,
		sentDate: 0,
		isRead: true,
		hasAttachment: false,
		hasStars: false,
		star: "None",
		isDeleted: false,
		senderTrust: "unknown",
		category: "uncategorized",
		status: "active",
		syncStatus: "abandoned",
		abandonedMutation: "none",
		createdAt: 0,
		updatedAt: 0,
		...over,
	}) as RemitImapThreadMessageResponse;

const mount = (
	threadMessage: RemitImapThreadMessageResponse,
	accountId: string | undefined,
): void => {
	harness = createDomHarness();
	harness.render(
		createElement(
			QueryClientProvider,
			{ client: harness.queryClient },
			createElement(
				ErrorBannerProvider,
				null,
				createElement(
					RoleAppointmentPromptProvider,
					null,
					createElement(MessageSettlementAlert, { threadMessage, accountId }),
				),
			),
		),
	);
};

const settle = async (done: () => boolean = () => false): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	for (let round = 0; round < 40; round += 1) {
		await harness.flush();
		await harness.wait(0);
		if (done()) return;
	}
};

const labels = (): string[] =>
	(harness?.queryAll("button") ?? []).map(
		(button) => button.getAttribute("aria-label") ?? button.textContent ?? "",
	);

const notice = (): string => harness?.text() ?? "";

beforeEach(() => {
	http = mockFetch((call) => respond(call.path));
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
});

describe("MessageSettlementAlert", () => {
	it("says nothing about a row no mutation gave up on", async () => {
		mount(
			thread({ syncStatus: "synced", abandonedMutation: "delete" }),
			ACCOUNT,
		);
		await settle();

		assert.equal(notice(), "");
	});

	it("offers Delete again for a delete that gave up", async () => {
		mount(thread({ abandonedMutation: "delete" }), ACCOUNT);
		await settle();

		assert.match(notice(), /was not deleted/i);
		assert.ok(labels().some((label) => /delete again/i.test(label)));
	});

	/**
	 * The account lookup fans out to `/config` and then to every account's
	 * mailbox list. Asking for it from each expanded message put that behind
	 * every open row in the product — and it did, until it was scoped to the one
	 * case that needs it. Pinned on the wire, because the cost is a request and
	 * only the request proves it is not being made.
	 */
	it("asks for no configuration at all unless a move gave up", async () => {
		mount(thread({ abandonedMutation: "delete" }), ACCOUNT);
		await settle();

		assert.deepEqual(http.to("/config"), []);
	});

	it("asks for none on a healthy row either", async () => {
		mount(thread({ syncStatus: "synced" }), undefined);
		await settle();

		assert.deepEqual(http.to("/config"), []);
	});

	it("offers a folder picker for a move that gave up, never Delete again", async () => {
		mount(thread({ abandonedMutation: "move" }), ACCOUNT);
		await settle(() => labels().some((label) => /move again/i.test(label)));

		assert.match(notice(), /was not moved/i);
		assert.ok(labels().some((label) => /move again/i.test(label)));
		assert.ok(!labels().some((label) => /delete again/i.test(label)));
	});

	it("resolves the account from the row's mailbox when the caller has none", async () => {
		mount(thread({ abandonedMutation: "move" }), undefined);
		await settle(() => labels().some((label) => /move again/i.test(label)));

		assert.ok(
			labels().some((label) => /move again/i.test(label)),
			"a notice that names a failure always carries its way out",
		);
	});
});
