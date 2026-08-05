/**
 * What the app owes a window with no browser chrome.
 *
 * Installed to a home screen there is no address bar to read, no back button to
 * press and no allowance made on the app's behalf for the notch or the home
 * indicator. Three consequences are observable from a browser and are asserted
 * here: the document opts into the display cutout, a link out of mail leaves for
 * a separate context rather than taking the app's own window with it, and every
 * view a tap pushes carries its own way back.
 *
 * A quoted reply is where the link assertion has to land. The reading pane
 * renders mail inside a sandboxed frame, but compose paints the quote into the
 * app's own document, so that is the window a sender's link could otherwise
 * navigate away.
 *
 * What is left for a real device is the install itself and where iOS hands the
 * Microsoft sign-in back to. Neither is something a browser can be asked.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { appendMessages, waitForServerMailbox } from "../src/imap.js";

const MOBILE = { width: 390, height: 844 };

const rows = (page: Page): Locator => page.locator("[data-message-row]");

const tag = `standalone${Date.now()}`;
const linkSubject = `Standalone link ${tag}`;
const linkHref = "https://links.example.test/campaign";

test.describe("Launched without browser chrome", () => {
	test.use({ viewport: MOBILE });

	test("the served document opts into the display cutout", async ({ page }) => {
		await page.goto("/");

		// Both HTML templates carry this; the one under test is whichever this
		// deployment was built from.
		await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
			"content",
			/viewport-fit=cover/,
		);
	});

	test("an open thread offers its own way back to the list", async ({
		page,
		run,
	}) => {
		await page.goto(`/mail/${run.inboxId}`);
		await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });

		await rows(page).first().click();
		await page.waitForURL(/selectedMessageId=/);

		const back = page.getByRole("button", { name: "Back to messages" });
		await expect(back).toBeVisible();
		await back.click();

		await expect(page).not.toHaveURL(/selectedMessageId=/);
		await expect(rows(page).first()).toBeVisible();
	});

	test("settings offers its own way back to mail", async ({ page }) => {
		await page.goto("/settings/accounts");

		const back = page.getByRole("button", { name: "Back to mail" });
		await expect(back).toBeVisible({ timeout: 30_000 });
		await back.click();

		await expect(page).toHaveURL(/\/mail/);
	});

	test.describe("a link in mail", () => {
		test.beforeEach(async ({ run, api }) => {
			await appendMessages(run.imapUser, [
				{
					subject: linkSubject,
					contentType: "text/html",
					body: `<p>Read the <a href="${linkHref}">announcement</a>.</p>`,
				},
			]);
			await api.triggerSync(run.accountId);
		});

		// The suite shares one inbox and runs serially, so the fixture leaves
		// again. The wait is on Dovecot: the delete is answered off the read model
		// and pushed to IMAP behind it.
		test.afterEach(async ({ api, run }) => {
			const leftover = await api.searchMatchingMessageIds(run.inboxId, tag);
			if (leftover.length === 0) return;
			await api.deleteMessages(leftover);
			await waitForServerMailbox(
				run.imapUser,
				"INBOX",
				(subjects) => !subjects.some((subject) => subject.includes(tag)),
				{ what: `the ${tag} fixture to leave the inbox` },
			);
		});

		test("opens outside the app, in the body and in a quoted reply", async ({
			page,
			run,
		}) => {
			// An appended message has to reach the read model through a sync before
			// it can be opened, and the cleanup wait follows the body.
			test.setTimeout(180_000);

			const seeded = rows(page).filter({ hasText: linkSubject });
			await expect(async () => {
				await page.goto(`/mail/${run.inboxId}`);
				await expect(seeded).toBeVisible({ timeout: 5_000 });
			}).toPass({ timeout: 60_000 });

			await seeded.click();
			await page.waitForURL(/selectedMessageId=/);

			// The reading pane renders the body in its sandboxed frame.
			const bodyLink = page
				.frameLocator('iframe[title="Email content"]')
				.getByRole("link", { name: "announcement" });
			await expect(bodyLink).toHaveAttribute("href", linkHref);
			await expect(bodyLink).toHaveAttribute("target", "_blank");
			await expect(bodyLink).toHaveAttribute("rel", /noopener/);
			await expect(bodyLink).toHaveAttribute("rel", /noreferrer/);

			// The quoted copy of the same mail, this time in the app's own document.
			await page.getByRole("button", { name: "Reply", exact: true }).click();
			const quoteToggle = page.getByRole("button", { name: /wrote:$/ });
			await expect(quoteToggle).toBeVisible({ timeout: 30_000 });
			await quoteToggle.click();

			const quotedLink = page
				.locator("blockquote")
				.getByRole("link", { name: "announcement" });
			await expect(quotedLink).toHaveAttribute("target", "_blank");
			// noopener denies the opened page a handle on the window it came from —
			// an installed app has no address bar to notice it being steered.
			await expect(quotedLink).toHaveAttribute("rel", /noopener/);
			await expect(quotedLink).toHaveAttribute("rel", /noreferrer/);
		});
	});
});
