import type { BrowserContext } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const SHOW_INFO = "Show intelligence sidebar";

const STAMP = Date.now();
const SUBJECT = `Your parcel is waiting for collection ${STAMP}`;
const SENDER_NAME = "Parcel Desk";
const SENDER_DOMAIN = "harbour-logistics.test";
const OFF_DOMAIN_LINK = "parcel-collect.test";

test.describe("A Junk arrival Remit does not judge junk", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(300_000);
		run = await provisionIsolatedRun("E2E Junk Arrival");
		api = new ApiClient(run);

		await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((mailbox) => mailbox.fullPath === "Junk"),
			{ timeoutMs: 60_000, what: "the Junk mailbox to sync" },
		);
		await api.syncPastMailbox(run.accountId, "Junk");

		await appendMessages(
			run.imapUser,
			[
				{
					subject: SUBJECT,
					from: `${SENDER_NAME} <notices@${SENDER_DOMAIN}>`,
					body: `This one does not belong in Spam. Collect it at https://${OFF_DOMAIN_LINK}/track`,
					headers: [
						[
							"DKIM-Signature",
							`v=1; a=rsa-sha256; d=${SENDER_DOMAIN}; s=s1; h=from:to; b=xxx`,
						],
					],
				},
			],
			"Junk",
		);
		await api.syncPastMailbox(run.accountId, "Junk");

		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: { width: 1440, height: 900 },
		});
	});

	test.afterAll(async () => {
		await context?.close();
	});

	test("moves to the Inbox and still shows its sender mismatch", async () => {
		test.setTimeout(180_000);

		const threads = await waitFor(
			() => api.listThreads(run.inboxId),
			(items) => items.some((thread) => thread.subject === SUBJECT),
			{
				timeoutMs: 60_000,
				what: `"${SUBJECT}" to move from Junk to the Inbox`,
			},
		);
		const thread = threads.find((item) => item.subject === SUBJECT);
		if (!thread) throw new Error("unreachable: matched but not found");

		const messages = await waitFor(
			() => api.listThreadMessages(thread.threadId),
			(items) =>
				items.some(
					(item) =>
						item.messageId === thread.messageId &&
						item.authenticity?.displayNameCorrespondence !== undefined,
				),
			{
				timeoutMs: 60_000,
				what: `"${SUBJECT}" to be compared against its sender`,
			},
		);
		const authenticity = messages.find(
			(item) => item.messageId === thread.messageId,
		)?.authenticity;
		expect(authenticity?.fromDomain).toBe(SENDER_DOMAIN);
		expect(authenticity?.dkimMismatch).toBe(false);
		expect(authenticity?.displayNameCorrespondence).toBe("Unrelated");
		expect(authenticity?.offDomainLinkDomains).toEqual([OFF_DOMAIN_LINK]);

		const page = await context.newPage();
		await page.goto(`/mail/${run.inboxId}`);
		const row = page.getByText(SUBJECT, { exact: true }).first();
		await expect(row).toBeVisible({ timeout: 30_000 });
		await row.click();
		await page.waitForURL(MAILBOX_THREAD_URL);
		await expect(
			page
				.getByRole("article")
				.getByRole("heading", { name: SUBJECT, exact: true }),
		).toBeVisible({ timeout: 15_000 });

		const show = page.getByRole("button", { name: SHOW_INFO });
		if (await show.isVisible()) await show.click();

		await expect(
			page.getByText(
				`The name it shows, "${SENDER_NAME}", has nothing to do with ${SENDER_DOMAIN}.`,
				{ exact: false },
			),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByText(`Its links go to ${OFF_DOMAIN_LINK}.`, { exact: false }),
		).toBeVisible();
	});
});
