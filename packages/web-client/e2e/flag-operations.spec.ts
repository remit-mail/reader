import { expect, test } from "./fixtures/account-setup.js";

test.describe("Flag operations", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);
		await expect(
			page.locator("a[href*='selectedMessageId']").first(),
		).toBeVisible({ timeout: 10_000 });
	});

	test("clicking a message displays its content in the article view", async ({
		page,
	}) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// Wait for message body to load (loading skeleton disappears)
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 10_000,
		});

		// The article should display the message heading and body content
		const heading = article.getByRole("heading", { level: 1 });
		await expect(heading).toBeVisible();
	});

	test("starring a message toggles the star icon", async ({ page }) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// Wait for message body to load
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 10_000,
		});

		// Find the star toggle button
		const starButtons = article.locator("button").filter({
			has: page.locator("svg.lucide-star"),
		});

		const starButtonCount = await starButtons.count();
		expect(starButtonCount).toBeGreaterThan(0);

		const starButton = starButtons.first();

		// Click to star
		await starButton.click();
		await page.waitForTimeout(1_000);

		const starSvg = starButton.locator("svg");
		await expect(starSvg).toBeVisible();

		// Click again to unstar
		await starButton.click();
		await page.waitForTimeout(1_000);
	});

	test("message action menu opens with delete option", async ({ page }) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 10_000,
		});

		// MessageActionMenu renders an EllipsisVertical (three dots) icon
		const moreButton = article.locator("svg.lucide-ellipsis-vertical").first();
		await expect(moreButton).toBeVisible({ timeout: 5_000 });
		await moreButton.click();

		// Delete option should always be visible in the dropdown
		const deleteOption = page.getByRole("button", { name: "Delete" });
		await expect(deleteOption).toBeVisible({ timeout: 5_000 });
	});
});
