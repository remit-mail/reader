/**
 * Regression cover for #46: a conversation showed the incoming half only, because
 * the web client scoped its thread request to the browsed mailbox and the user's
 * own replies live in Sent.
 *
 * The reply is sent through reader and filed by it, so the Sent half is the copy
 * the product produced, not one planted beside it.
 */

import type { BrowserContext } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { listServerSubjects } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const STAMP = Date.now();
const RECEIVED_SUBJECT = `Contract renewal ${STAMP}`;
const RECEIVED_FROM_NAME = "Dana Whitfield";
const REPLY_SUBJECT = `Re: ${RECEIVED_SUBJECT}`;

test.describe("A conversation spanning INBOX and Sent", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(300_000);
		run = await provisionIsolatedRun("E2E Thread Sent", [
			{
				subject: RECEIVED_SUBJECT,
				from: `${RECEIVED_FROM_NAME} <dana@remit.test>`,
				messageIdHeader: `<renewal-${STAMP}@remit.test>`,
			},
		]);
		api = new ApiClient(run);
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("opening it from the inbox shows the reply sent from reader", async () => {
		test.setTimeout(300_000);
		const page = await context.newPage();

		await api.messageIdForSubject(run.inboxId, RECEIVED_SUBJECT);
		await page.goto(`/mail/${run.inboxId}`);
		await page.getByText(RECEIVED_SUBJECT, { exact: true }).first().click();
		await page.waitForURL(MAILBOX_THREAD_URL);
		await expect(page.getByRole("article").first()).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole("button", { name: "Reply", exact: true }).click();
		await expect(page.locator("[data-subject-field]")).toHaveValue(/^Re: /, {
			timeout: 30_000,
		});
		await page.getByTestId("compose-body").click();
		await page.keyboard.type("Renewal confirmed on our side.");
		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(page.getByTestId("compose-body")).toBeHidden({
			timeout: 30_000,
		});

		await waitFor(
			() => listServerSubjects(run.imapUser, "Sent"),
			(subjects) => subjects.includes(REPLY_SUBJECT),
			{ timeoutMs: 120_000, what: "the reply to be filed in Sent" },
		);
		const threadId = (await api.listThreads(run.inboxId)).find(
			(thread) => thread.subject === RECEIVED_SUBJECT,
		)?.threadId;
		if (!threadId) throw new Error("the received message has no thread");
		await waitFor(
			async () => {
				await api.triggerSync(run.accountId);
				return api.listThreadMessages(threadId);
			},
			(items) => items.some((item) => item.subject === REPLY_SUBJECT),
			{
				timeoutMs: 120_000,
				intervalMs: 5_000,
				what: "the filed reply to join the thread",
			},
		);

		await page.goto(`/mail/${run.inboxId}`);
		await page.getByText(RECEIVED_SUBJECT, { exact: true }).first().click();
		await page.waitForURL(MAILBOX_THREAD_URL);

		// The count the header states is the count the reader believes it has, so
		// a conversation truncated to its inbox half fails here first.
		const conversation = page.getByRole("article");
		await expect(conversation).toBeVisible({ timeout: 30_000 });
		await expect(conversation.getByText("2 messages")).toBeVisible({
			timeout: 30_000,
		});
		await expect(
			conversation.getByText(RECEIVED_FROM_NAME).first(),
		).toBeVisible();
	});
});
