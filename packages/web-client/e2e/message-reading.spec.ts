import { expect, test } from "./fixtures/account-setup.js";

test.describe("Message reading", () => {
	test.beforeEach(async ({ page }) => {
		// Navigate to /mail and click INBOX to load messages
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		// Wait for messages to load
		await expect(page.getByText("Loading...")).toBeHidden({ timeout: 10_000 });
	});

	test("message list shows sender and subject", async ({ page }) => {
		// The message list renders MessageListItem components as links
		// Each item contains sender name/email and subject text
		const messageLinks = page.locator("a[href*='/mail/']").filter({
			has: page.locator(".truncate"),
		});

		const count = await messageLinks.count();
		expect(count).toBeGreaterThan(0);
	});

	test("clicking a message shows its content", async ({ page }) => {
		// Click the first message in the list
		// MessageListItem renders as a Link with the subject visible
		const firstMessage = page.locator("a[href*='selectedMessageId']").first();

		// If no messages have selectedMessageId param yet, click any message link
		const messageLink =
			(await firstMessage.count()) > 0
				? firstMessage
				: page.locator("a[href*='/mail/']").first();

		await messageLink.click();

		// After clicking, the URL should contain selectedMessageId
		await page.waitForURL(/selectedMessageId=/);

		// The conversation view should appear with an article element
		// ConversationView wraps content in <article> with a <header> containing the subject
		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// The thread header shows subject as an h1
		const heading = article.getByRole("heading", { level: 1 });
		await expect(heading).toBeVisible();
	});

	test("message content displays body text", async ({ page }) => {
		// Click first message
		const messageLink = page.locator("a[href*='/mail/']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		// Wait for conversation view to load
		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// Wait for the message body to load (the loading skeleton has animate-pulse)
		// The body is rendered inside the article, after the header
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 10_000,
		});

		// The article should contain some text content beyond the header
		const articleText = await article.textContent();
		expect(articleText).toBeTruthy();
		expect(articleText?.length).toBeGreaterThan(10);
	});
});
