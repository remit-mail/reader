import { expect, test } from "./fixtures/account-setup.js";

test.describe("Message reading", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		// Wait for message list items to appear
		await expect(
			page.locator("a[href*='selectedMessageId']").first(),
		).toBeVisible({ timeout: 10_000 });
	});

	test("message list shows sender and subject", async ({ page }) => {
		const messageLinks = page.locator("a[href*='selectedMessageId']");
		const count = await messageLinks.count();
		expect(count).toBeGreaterThan(0);
	});

	test("clicking a message shows its content", async ({ page }) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();

		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		const heading = article.getByRole("heading", { level: 1 });
		await expect(heading).toBeVisible();
	});

	test("message content displays body text", async ({ page }) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// Wait for message body to load (loading skeleton disappears)
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 10_000,
		});

		const articleText = await article.textContent();
		expect(articleText).toBeTruthy();
		expect(articleText?.length).toBeGreaterThan(10);
	});
});
