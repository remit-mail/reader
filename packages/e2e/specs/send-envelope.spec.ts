/**
 * Who a reply and a forward are addressed to, and who they come from, read off
 * the submission the sink accepted.
 *
 * Both facts have only ever been checked in the browser, on the chips the
 * composer draws, and both have gone wrong in ways a chip does not show. A
 * forward that only rewrote the subject kept the person being answered in To
 * and sent the conversation back to them (#797). A reply left from the head of
 * the configured account list rather than from the identity the message was
 * delivered to, and put the reader's own address in the Cc of a Reply all
 * (#819). Neither is visible in the outbox row either: the row is what the app
 * meant to send, and this is the set of addresses a recipient's server was
 * handed.
 *
 * Two accounts on one isolated user, because "the identity the message reached"
 * is not a claim a one-account instance can fail — its only account is also its
 * first, so both answers produce the same bytes.
 */

import type { BrowserContext, Locator, Page } from "@playwright/test";
import { ApiClient } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	connectIsolatedAccount,
	type IsolatedAccount,
	type IsolatedRun,
	provisionIsolatedRun,
} from "../src/provision.js";
import {
	type AcceptedEnvelope,
	readAcceptedEnvelope,
	waitForAcceptedMessage,
} from "../src/smtp-sink.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const DESKTOP = { width: 1512, height: 864 };

/** The correspondent being answered, and the two others on the thread. */
const OUTSIDER = "outsider@remit.test";
const COLLEAGUE = "colleague@remit.test";
const BYSTANDER = "bystander@remit.test";

/** Who the reader forwards to, and the only address that forward may name. */
const FORWARDEE = "forwardee@remit.test";

const stamp = Date.now();
const ANSWERED_SUBJECT = `Envelope reply ${stamp}`;
const FORWARDED_SUBJECT = `Envelope forward ${stamp}`;

const openMessage = async (
	page: Page,
	mailboxId: string,
	subject: string,
): Promise<void> => {
	await page.goto(`/mail/${mailboxId}`);
	await page.getByText(subject, { exact: true }).first().click();
	await page.waitForURL(MAILBOX_THREAD_URL);
	await expect(page.getByRole("article")).toBeVisible({ timeout: 30_000 });
};

/** The chips in one address field — a precondition here, never an assertion. */
const chips = (page: Page, field: string): Locator =>
	page
		.locator(`[data-address-field="${field}"]`)
		.getByRole("button", { name: /^Remove / });

const sendAndRead = async (
	page: Page,
	subject: string,
): Promise<AcceptedEnvelope> => {
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByTestId("compose-body")).toBeHidden({
		timeout: 30_000,
	});
	const accepted = await waitForAcceptedMessage(subject);
	return readAcceptedEnvelope(accepted.id);
};

test.describe("The envelope a reply and a forward go out with", () => {
	let run: IsolatedRun;
	let second: IsolatedAccount;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(300_000);
		run = await provisionIsolatedRun("E2E Envelope First");
		api = new ApiClient(run);

		// Both messages are delivered to the second identity, so every answer
		// written here is written from the account that is not the head of the
		// list. Neither names a To of its own: the builder addresses a seeded
		// message to the mailbox it is appended to, which is the reader — and the
		// reader's own address arriving in To is what a Reply all has to leave
		// out of Cc.
		second = await connectIsolatedAccount(api, "E2E Envelope Second", [
			{
				subject: ANSWERED_SUBJECT,
				from: `Outsider <${OUTSIDER}>`,
				headers: [["Cc", `Colleague <${COLLEAGUE}>, Bystander <${BYSTANDER}>`]],
			},
			{ subject: FORWARDED_SUBJECT, from: `Outsider <${OUTSIDER}>` },
		]);

		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("a reply leaves from the identity the message reached", async () => {
		test.setTimeout(240_000);
		const page = await context.newPage();

		await api.messageIdForSubject(second.inboxId, ANSWERED_SUBJECT);
		await openMessage(page, second.inboxId, ANSWERED_SUBJECT);

		await page.getByRole("button", { name: "Reply all", exact: true }).click();
		await expect(page.locator("[data-subject-field]")).toHaveValue(/^Re: /, {
			timeout: 30_000,
		});
		await page.getByTestId("compose-body").click();
		await page.keyboard.type("Answering from the mailbox this arrived in.");

		const envelope = await sendAndRead(page, `Re: ${ANSWERED_SUBJECT}`);

		// The identity the mail was delivered to, on the header and on the SMTP
		// conversation both. Sent from the first account instead, this is the one
		// address on the wire that would have said so.
		expect(envelope.from).toBe(second.imapUser);
		expect(envelope.returnPath).toBe(second.imapUser);

		// Reply all answers the sender and copies everyone else the message named
		// — and the reader is not one of those. Their own address in Cc is the
		// other half of #819, and it arrives here as a recipient rather than as a
		// chip nobody read.
		expect(envelope.to).toEqual([OUTSIDER]);
		expect([...envelope.cc].sort()).toEqual([BYSTANDER, COLLEAGUE].sort());

		// Nothing the headers do not name, so the two lines above are the whole
		// set of recipients the submission carried.
		expect(envelope.bcc).toEqual([]);
	});

	test("a forward goes to the reader's recipient and to nobody it inherited", async () => {
		test.setTimeout(240_000);
		const page = await context.newPage();

		await api.messageIdForSubject(second.inboxId, FORWARDED_SUBJECT);
		await openMessage(page, second.inboxId, FORWARDED_SUBJECT);

		// Reply first, which is the state #797 was about: the composer is already
		// addressed to the person being answered when Forward is pressed, and a
		// forward that only rewrote the subject sent the thread back to them.
		await page.getByRole("button", { name: "Reply", exact: true }).click();
		await expect(page.locator("[data-subject-field]")).toHaveValue(/^Re: /, {
			timeout: 30_000,
		});
		await expect(chips(page, "To")).not.toHaveCount(0);

		await page.getByRole("button", { name: "Forward", exact: true }).click();
		await expect(page.locator("[data-subject-field]")).toHaveValue(/^Fwd: /);

		await page.getByPlaceholder("Recipients").fill(FORWARDEE);
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.getByTestId("compose-body").click();
		await page.keyboard.type("Passing this on.");

		const envelope = await sendAndRead(page, `Fwd: ${FORWARDED_SUBJECT}`);

		expect(envelope.from).toBe(second.imapUser);
		expect(envelope.to).toEqual([FORWARDEE]);
		expect(envelope.cc).toEqual([]);
		expect(envelope.bcc).toEqual([]);
	});
});
