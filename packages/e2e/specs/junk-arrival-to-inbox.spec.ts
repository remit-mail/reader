import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const SHOW_INFO = "Show intelligence sidebar";

test.describe("A Junk arrival Remit does not judge junk", () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test("moves to the Inbox and still shows its sender mismatch", async ({
		api,
		page,
		run,
	}) => {
		const threads = await waitFor(
			() => api.listThreads(run.inboxId),
			(items) =>
				items.some((thread) => thread.subject === run.junkArrivalSubject),
			{
				timeoutMs: 60_000,
				what: `"${run.junkArrivalSubject}" to move from Junk to the Inbox`,
			},
		);
		const thread = threads.find(
			(item) => item.subject === run.junkArrivalSubject,
		);
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
				what: `"${run.junkArrivalSubject}" to be compared against its sender`,
			},
		);
		const authenticity = messages.find(
			(item) => item.messageId === thread.messageId,
		)?.authenticity;
		expect(authenticity?.fromDomain).toBe(run.junkArrivalSenderDomain);
		expect(authenticity?.dkimMismatch).toBe(false);
		expect(authenticity?.displayNameCorrespondence).toBe("Unrelated");
		expect(authenticity?.offDomainLinkDomains).toEqual([
			run.junkArrivalOffDomainLinkDomain,
		]);

		await page.goto(`/mail/${run.inboxId}`);
		const row = page.getByText(run.junkArrivalSubject, { exact: true }).first();
		await expect(row).toBeVisible({ timeout: 30_000 });
		await row.click();
		await page.waitForURL(MAILBOX_THREAD_URL);
		await expect(
			page
				.getByRole("article")
				.getByRole("heading", { name: run.junkArrivalSubject, exact: true }),
		).toBeVisible({ timeout: 15_000 });

		const show = page.getByRole("button", { name: SHOW_INFO });
		if (await show.isVisible()) await show.click();

		await expect(
			page.getByText(
				`The name it shows, "${run.junkArrivalSenderName}", has nothing to do with ${run.junkArrivalSenderDomain}.`,
				{ exact: false },
			),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByText(`Its links go to ${run.junkArrivalOffDomainLinkDomain}.`, {
				exact: false,
			}),
		).toBeVisible();
	});
});
