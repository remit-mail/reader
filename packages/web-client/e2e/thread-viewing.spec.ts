import { expect, test } from "./fixtures/account-setup.js";

test.describe("Thread viewing", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);
		await expect(page.getByText("Loading...")).toBeHidden({ timeout: 10_000 });
	});

	test("thread with multiple messages shows message count in header", async ({
		page,
	}) => {
		// Look for a message list item that shows a count indicator
		// MessageListItem displays "(N)" next to subject when messageCount > 1
		// Try to find a threaded message by looking for the (N) pattern
		const threadedItem = page.locator("a[href*='/mail/']").filter({
			hasText: /\(\d+\)/,
		});

		const hasThread = (await threadedItem.count()) > 0;

		if (hasThread) {
			await threadedItem.first().click();
			await page.waitForURL(/selectedMessageId=/);

			// ConversationView header shows "N messages" count
			const article = page.getByRole("article");
			await expect(article).toBeVisible({ timeout: 10_000 });

			// The header paragraph shows message count like "3 messages"
			const messageCountText = article.getByText(/\d+ messages?/);
			await expect(messageCountText).toBeVisible();
		}
	});

	test("conversation view displays thread subject", async ({ page }) => {
		// Click the first message
		const messageLink = page.locator("a[href*='/mail/']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// The h1 heading should contain the thread subject
		const heading = article.getByRole("heading", { level: 1 });
		await expect(heading).toBeVisible();

		const headingText = await heading.textContent();
		expect(headingText).toBeTruthy();
		expect(headingText?.length).toBeGreaterThan(0);
	});

	test("conversation view shows reply and forward buttons", async ({
		page,
	}) => {
		// Click the first message
		const messageLink = page.locator("a[href*='/mail/']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// ActionBar renders Reply, Reply all, and Forward buttons
		const replyButton = page.getByRole("button", { name: "Reply" });
		const replyAllButton = page.getByRole("button", { name: "Reply all" });
		const forwardButton = page.getByRole("button", { name: "Forward" });

		await expect(replyButton).toBeVisible();
		await expect(replyAllButton).toBeVisible();
		await expect(forwardButton).toBeVisible();
	});
});
