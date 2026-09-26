/**
 * Mail in Junk is compared against its sender whether or not the provider
 * called it spam (#610). The seeded Junk message carries no provider verdict,
 * a DKIM signature aligned with its From domain, a display name that belongs
 * to nobody at that domain, and a link that leaves it. Before the fix the
 * comparison ran only over provider-flagged mail, so this message read as
 * signed and unremarkable.
 */
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const SHOW_INFO = "Show intelligence sidebar";

test.describe("Sender mismatch in Junk", () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test("a Junk message the provider rated clean carries and shows the mismatch", async ({
		api,
		page,
		run,
	}) => {
		const mailboxes = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((mailbox) => mailbox.fullPath === "Junk"),
			{ timeoutMs: 60_000, what: "the Junk mailbox to sync" },
		);
		const junk = mailboxes.find((mailbox) => mailbox.fullPath === "Junk");
		if (!junk) throw new Error("unreachable: Junk was matched but not found");

		const threads = await waitFor(
			() => api.listThreads(junk.mailboxId),
			(items) => items.some((thread) => thread.subject === run.spamSubject),
			{ timeoutMs: 60_000, what: `"${run.spamSubject}" to sync into Junk` },
		);
		const thread = threads.find((item) => item.subject === run.spamSubject);
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
				what: `"${run.spamSubject}" to be compared against its sender`,
			},
		);
		const authenticity = messages.find(
			(item) => item.messageId === thread.messageId,
		)?.authenticity;
		expect(authenticity?.fromDomain).toBe(run.spamSenderDomain);
		expect(authenticity?.dkimMismatch).toBe(false);
		expect(authenticity?.displayNameCorrespondence).toBe("Unrelated");
		expect(authenticity?.offDomainLinkDomains).toEqual([
			run.spamOffDomainLinkDomain,
		]);

		await page.goto(`/mail/${junk.mailboxId}`);
		const row = page.getByText(run.spamSubject, { exact: true }).first();
		await expect(row).toBeVisible({ timeout: 30_000 });
		await row.click();
		await page.waitForURL(MAILBOX_THREAD_URL);
		await expect(
			page
				.getByRole("article")
				.getByRole("heading", { name: run.spamSubject, exact: true }),
		).toBeVisible({ timeout: 15_000 });

		const show = page.getByRole("button", { name: SHOW_INFO });
		if (await show.isVisible()) await show.click();

		await expect(
			page.getByText(
				`The name it shows, "${run.spamSenderName}", has nothing to do with ${run.spamSenderDomain}.`,
				{ exact: false },
			),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByText(`Its links go to ${run.spamOffDomainLinkDomain}.`, {
				exact: false,
			}),
		).toBeVisible();
	});
});
