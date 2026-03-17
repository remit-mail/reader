import { expect, test } from "./fixtures/account-setup.js";

test.describe("Thread viewing", () => {
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

	test("thread with multiple messages shows message count in header", async ({
		page,
	}) => {
		// Look for a threaded message by the (N) count pattern in the list
		const threadedItem = page
			.locator("a[href*='selectedMessageId']")
			.filter({ hasText: /\(\d+\)/ });

		const hasThread = (await threadedItem.count()) > 0;

		if (hasThread) {
			await threadedItem.first().click();
			await page.waitForURL(/selectedMessageId=/);

			const article = page.getByRole("article");
			await expect(article).toBeVisible({ timeout: 10_000 });

			const messageCountText = article.getByText(/\d+ messages?/);
			await expect(messageCountText).toBeVisible();
		}
	});

	test("conversation view displays thread subject", async ({ page }) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		const heading = article.getByRole("heading", { level: 1 });
		await expect(heading).toBeVisible();

		const headingText = await heading.textContent();
		expect(headingText).toBeTruthy();
		expect(headingText?.length).toBeGreaterThan(0);
	});

	test("conversation view shows reply and forward buttons", async ({
		page,
	}) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		const replyButton = article.getByRole("button", {
			name: "Reply",
			exact: true,
		});
		const replyAllButton = article.getByRole("button", {
			name: "Reply all",
		});
		const forwardButton = article.getByRole("button", { name: "Forward" });

		await expect(replyButton).toBeVisible();
		await expect(replyAllButton).toBeVisible();
		await expect(forwardButton).toBeVisible();
	});
});
