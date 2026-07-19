/**
 * Ported from the retired seeded smoke suite. Reads a message the suite itself
 * put on the IMAP server, so a pass means the body travelled the whole way:
 * IMAP fetch, storage, content delivery, and render.
 */
import { expect, test } from "../src/fixtures.js";

test.beforeEach(async ({ page }) => {
	await page.goto("/mail");
	const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
	await expect(sidebar).toBeVisible({ timeout: 20_000 });
	await sidebar.getByRole("link", { name: /inbox/i }).click();
	await page.waitForURL(/\/mail\/[a-z0-9]+/);
	await expect(
		page.locator("a[href*='selectedMessageId']").first(),
	).toBeVisible({ timeout: 30_000 });
});

test.describe("Message reading", () => {
	test("the inbox lists the messages that were appended", async ({
		page,
		run,
	}) => {
		for (const subject of run.seededSubjects) {
			await expect(page.getByText(subject).first()).toBeVisible({
				timeout: 15_000,
			});
		}
	});

	test("opening a message shows its subject and body", async ({ page }) => {
		await page.locator("a[href*='selectedMessageId']").first().click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 15_000 });
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 20_000,
		});

		const heading = article.getByRole("heading", { level: 1 });
		await expect(heading).toBeVisible();
		expect((await heading.textContent())?.trim().length).toBeGreaterThan(0);
		expect((await article.textContent())?.length).toBeGreaterThan(10);
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
		await expect(page.getByRole("button", { name: "Reply all" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Forward" })).toBeVisible();
	});
});
