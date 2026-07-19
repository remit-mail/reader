/**
 * Ported from the retired seeded smoke suite. Reads a message the suite itself
 * put on the IMAP server, so a pass means the body travelled the whole way:
 * IMAP fetch, storage, content delivery, and render.
 *
 * Text matchers here are exact. A substring match on a subject cannot tell a
 * correct render from a corrupted one — "Lunch on Thursday?" is a substring of
 * anything that mangles it by appending.
 */
import { expect, test } from "../src/fixtures.js";

test.beforeEach(async ({ page }) => {
	await page.goto("/mail");
	const sidebar = page.getByRole("navigation", {
		name: "Mailboxes",
		exact: true,
	});
	await expect(sidebar).toBeVisible({ timeout: 20_000 });
	await sidebar.getByRole("link", { name: /inbox/i }).click();
	await page.waitForURL(/\/mail\/[a-z0-9]+/);
	await expect(
		page.locator("a[href*='selectedMessageId']").first(),
	).toBeVisible({ timeout: 30_000 });
});

test.describe("Message reading", () => {
	test("the inbox lists exactly the messages that were appended", async ({
		page,
		run,
	}) => {
		for (const subject of run.seededSubjects) {
			await expect(
				page.getByText(subject, { exact: true }).first(),
			).toBeVisible({ timeout: 15_000 });
		}

		// The mailbox this run owns held nothing before setup appended to it, so
		// the row count is knowable rather than "at least one".
		await expect(page.locator("a[href*='selectedMessageId']")).toHaveCount(
			run.seededSubjects.length,
			{ timeout: 15_000 },
		);
	});

	test("opening a message shows its subject and body", async ({
		page,
		run,
	}) => {
		const subject = run.seededSubjects[0];
		await page.getByText(subject, { exact: true }).first().click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 15_000 });
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 20_000,
		});

		// The message that opened is the message that was clicked, and its body is
		// the body that was appended — both asserted against known text rather
		// than against "something is there".
		await expect(article.getByRole("heading", { level: 1 })).toHaveText(
			subject,
		);
		await expect(article).toContainText(`Body of ${subject}.`);
	});

	test("the reply and forward actions are offered on an open message", async ({
		page,
	}) => {
		await page.locator("a[href*='selectedMessageId']").first().click();
		await page.waitForURL(/selectedMessageId=/);
		await expect(page.getByRole("article")).toBeVisible({ timeout: 15_000 });

		await expect(
			page.getByRole("button", { name: "Reply", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Reply all", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Forward", exact: true }),
		).toBeVisible();
	});
});
