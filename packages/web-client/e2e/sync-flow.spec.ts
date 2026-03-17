import { expect, test } from "./fixtures/account-setup.js";

test.describe("Sync flow e2e", () => {
	test("mailboxes appear after sync", async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		await expect(sidebar).toBeVisible();

		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await expect(inbox).toBeVisible();
	});

	test("messages appear in INBOX", async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await inbox.click();

		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await expect(messageLink).toBeVisible({ timeout: 15_000 });

		const messageLinks = page.locator("a[href*='selectedMessageId']");
		const count = await messageLinks.count();
		expect(count).toBeGreaterThan(0);
	});

	test("message content is readable", async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await expect(messageLink).toBeVisible({ timeout: 15_000 });
		await messageLink.click();

		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 15_000 });

		const heading = article.getByRole("heading", { level: 1 });
		await expect(heading).toBeVisible();
		const headingText = await heading.textContent();
		expect(headingText?.length).toBeGreaterThan(0);
	});
});
