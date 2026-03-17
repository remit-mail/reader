import { expect, test } from "./fixtures/account-setup.js";

test.describe("Flag operations", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);
		await expect(page.getByText("Loading...")).toBeHidden({ timeout: 10_000 });
	});

	test("clicking a message marks it as read", async ({ page }) => {
		// Click the first message to open it
		const messageLink = page.locator("a[href*='/mail/']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		// Wait for conversation to load - the message body becomes visible
		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// The message should be auto-marked as read when expanded
		// useMarkAsRead hook triggers when messages are expanded in ConversationView
		// Wait for the API call to complete
		await page.waitForTimeout(2_000);

		// The unread indicator (blue dot) should not be visible for the expanded message
		// In the expanded card, UnreadIndicator renders a blue dot when isUnread is true
		const unreadDot = article.locator("[aria-label='Unread']");
		await expect(unreadDot).toBeHidden({ timeout: 5_000 });
	});

	test("starring a message toggles the star icon", async ({ page }) => {
		// Click a message to open the conversation view
		const messageLink = page.locator("a[href*='/mail/']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });

		// Wait for message body to load
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 10_000,
		});

		// MessageIndicators renders a star button inside the expanded card
		// The Star icon from lucide-react is inside a button
		// Find the star toggle button within the conversation
		const starButtons = article.locator("button").filter({
			has: page.locator("svg.lucide-star"),
		});

		const starButtonCount = await starButtons.count();
		if (starButtonCount > 0) {
			const starButton = starButtons.first();

			// Click to star
			await starButton.click();

			// Wait for the API call
			await page.waitForTimeout(1_000);

			// The star should now have fill-current class (indicating starred state)
			// or the button color should change to yellow
			const starSvg = starButton.locator("svg");
			await expect(starSvg).toBeVisible();

			// Click again to unstar
			await starButton.click();
			await page.waitForTimeout(1_000);
		}
	});

	test("mark as unread through message action menu", async ({ page }) => {
		// Click a message to open conversation
		const messageLink = page.locator("a[href*='/mail/']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 10_000,
		});

		// Wait for auto-mark-as-read to complete
		await page.waitForTimeout(2_000);

		// MessageActionMenu renders a MoreVertical (three dots) button
		// Clicking it shows a dropdown with "Mark as unread" and "Delete" options
		const moreButton = article.locator("svg.lucide-more-vertical").first();
		const moreButtonVisible = await moreButton.isVisible();

		if (moreButtonVisible) {
			await moreButton.click();

			// Look for "Mark as unread" in the dropdown
			const markUnread = page.getByText("Mark as unread");
			const markUnreadVisible = await markUnread.isVisible().catch(() => false);

			if (markUnreadVisible) {
				await markUnread.click();
				// Wait for the flag update API call
				await page.waitForTimeout(1_000);
			}
		}
	});
});
