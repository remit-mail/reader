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
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const MOBILE = { width: 390, height: 844 };

const rows = (page: Page): Locator => page.locator("[data-message-row]");

const tag = `standalone${Date.now()}`;
const linkSubject = `Standalone link ${tag}`;
const linkHref = "https://links.example.test/campaign";

// Taller than several phone screens, so compose opening below the message is
// off screen unless the app takes the reader to it. A short fixture cannot tell
// the difference.
const longBody = [
	`<p>Read the <a href="${linkHref}">announcement</a>.</p>`,
	...Array.from(
		{ length: 60 },
		(_, index) =>
			`<p>Paragraph ${index + 1} of the announcement, which runs on at some length so the message is several screens tall on a phone.</p>`,
	),
].join("");

// A draft of the length someone actually writes on a phone. The composer takes
// the height of what is in it, so this is several screens of surface with Send
// at the far end of it.
const draftLines = Array.from(
	{ length: 30 },
	(_, index) =>
		`Line ${index + 1} of the reply, long enough to wrap more than once on a phone so the composer grows well past the screen.`,
);

const longDraft = draftLines.map((line) => `<p>${line}</p>`).join("");
const longDraftText = draftLines.join("\n\n");
const firstDraftLine = draftLines[0] ?? "";

/** A real clipboard event at the writing surface — a written draft, in one go. */
const writeDraft = (page: Page, html: string, text: string): Promise<void> =>
	page.evaluate(
		([htmlFlavour, textFlavour]) => {
			const element = document.querySelector('[data-testid="compose-body"]');
			if (!element) throw new Error("the composer is not mounted");
			const data = new DataTransfer();
			data.setData("text/html", htmlFlavour);
			data.setData("text/plain", textFlavour);
			element.dispatchEvent(
				new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
					clipboardData: data,
				}),
			);
		},
		[html, text],
	);

const heightOf = (locator: Locator): Promise<number> =>
	locator.evaluate((element) => element.getBoundingClientRect().height);

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
		await page.waitForURL(MAILBOX_THREAD_URL);

		const back = page.getByRole("button", { name: "Back to messages" });
		await expect(back).toBeVisible();
		await back.click();

		await expect(page).not.toHaveURL(MAILBOX_THREAD_URL);
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
					body: longBody,
				},
			]);
			await api.triggerSync(run.accountId);
		});

		// The suite shares one inbox and one account and runs serially, so both
		// the fixture and the draft compose autosaved leave again. The inbox wait
		// is on Dovecot: the delete is answered off the read model and pushed to
		// IMAP behind it.
		test.afterEach(async ({ api, run }) => {
			const leftover = await api.searchMatchingMessageIds(run.inboxId, tag);
			if (leftover.length > 0) {
				await api.deleteMessages(leftover);
				await waitForServerMailbox(
					run.imapUser,
					"INBOX",
					(subjects) => !subjects.some((subject) => subject.includes(tag)),
					{ what: `the ${tag} fixture to leave the inbox` },
				);
			}

			// Discarding takes the draft with it, so this finds nothing on the
			// path that ran to the end. It is here for the runs that did not.
			for (const entry of await api.listRemovableOutboxMessages()) {
				if (entry.subject.includes(tag)) {
					await api.deleteOutboxMessage(entry.outboxMessageId);
				}
			}
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
			await page.waitForURL(MAILBOX_THREAD_URL);

			// The reading pane renders the body in its sandboxed frame.
			const bodyLink = page
				.frameLocator('iframe[title="Email content"]')
				.getByRole("link", { name: "announcement" });
			await expect(bodyLink).toHaveAttribute("href", linkHref);
			await expect(bodyLink).toHaveAttribute("target", "_blank");
			await expect(bodyLink).toHaveAttribute("rel", /noopener/);
			await expect(bodyLink).toHaveAttribute("rel", /noreferrer/);

			// The quoted copy of the same mail, this time in the app's own document.
			// Reply opens compose in place and takes the reader to it. This account
			// has no SMTP, which compose says for itself rather than the button
			// saying nothing.
			await page.getByRole("button", { name: "Reply", exact: true }).click();
			const send = page.getByRole("button", { name: "Send", exact: true });
			await expect(send).toBeVisible({ timeout: 30_000 });
			await expect(
				page.getByTestId("compose-smtp-missing-banner"),
			).toBeInViewport();

			// What a phone has to survive: the composer is as tall as what is
			// written in it, so a draft of a few paragraphs runs past the screen
			// and Send is the last thing in it. Send has to be whole and on screen
			// at that length — an empty composer fits either way and proves
			// nothing.
			const composeBody = page.getByTestId("compose-body");
			await composeBody.click();
			await writeDraft(page, longDraft, longDraftText);
			await expect(composeBody).toContainText(firstDraftLine);

			const written = await heightOf(composeBody);
			expect(written).toBeGreaterThan(MOBILE.height);
			await expect(send).toBeInViewport({ ratio: 1 });

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

			// Compose autosaves, so this reply becomes a draft. Discard is what takes
			// it away, and it can only take away a draft that exists — so the save
			// has to land first.
			await expect(page.getByText("Draft saved")).toBeVisible({
				timeout: 30_000,
			});
			const discard = page.getByRole("button", { name: "Discard" });
			await discard.click();
			await expect(discard).toBeHidden();
		});
	});
});
