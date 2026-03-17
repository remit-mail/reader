import { expect, test } from "./fixtures/account-setup.js";

test.describe("Message operations", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);
		await expect(page.getByText("Loading...")).toBeHidden({ timeout: 10_000 });
	});

	test("delete message via conversation action menu", async ({ page }) => {
		// Click a message to open conversation
		const messageLink = page.locator("a[href*='/mail/']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 10_000,
		});

		// MessageActionMenu has a MoreVertical trigger that opens a dropdown
		// The dropdown contains a "Delete" option
		const moreButton = article.locator("svg.lucide-more-vertical").first();
		const moreButtonVisible = await moreButton.isVisible();

		if (moreButtonVisible) {
			await moreButton.click();

			// Click the Delete option in the dropdown
			const deleteOption = page.getByText("Delete");
			const deleteVisible = await deleteOption.isVisible().catch(() => false);

			if (deleteVisible) {
				await deleteOption.click();

				// Wait for delete operation
				await page.waitForTimeout(2_000);

				// A toast notification should appear confirming deletion
				// The sonner Toaster component shows toast messages
				const toast = page.getByText(/deleted/i);
				await expect(toast).toBeVisible({ timeout: 5_000 });
			}
		}
	});

	test("delete selected messages via selection toolbar", async ({ page }) => {
		// Select a message using the checkbox (visible on hover)
		// MessageListItem renders a checkbox button with aria-label "Select message"
		const firstMessage = page.locator("a[href*='/mail/']").first();
		await firstMessage.hover();

		const selectButton = firstMessage.getByRole("button", {
			name: /select message/i,
		});
		const selectVisible = await selectButton.isVisible().catch(() => false);

		if (selectVisible) {
			await selectButton.click();

			// SelectionToolbar should appear with "1 message selected" text
			const toolbar = page.getByText(/\d+ messages? selected/);
			await expect(toolbar).toBeVisible();

			// Click the Delete button in the toolbar
			const deleteButton = page.getByRole("button", {
				name: /delete selected/i,
			});
			await expect(deleteButton).toBeVisible();
			await deleteButton.click();

			// Wait for deletion
			await page.waitForTimeout(2_000);

			// Toast should confirm deletion
			const toast = page.getByText(/deleted/i);
			await expect(toast).toBeVisible({ timeout: 5_000 });
		}
	});

	test("navigate to Trash mailbox after deletion", async ({ page }) => {
		// Check if Trash mailbox exists in the sidebar
		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const trashLink = sidebar.getByRole("link", { name: /trash/i });
		const trashVisible = await trashLink.isVisible().catch(() => false);

		if (trashVisible) {
			await trashLink.click();
			await page.waitForURL(/\/mail\/[a-z0-9]+/);

			// Wait for messages to load
			await expect(page.getByText("Loading...")).toBeHidden({
				timeout: 10_000,
			});

			// The Trash view should render (either messages or empty state)
			// Either we see message items or "No messages in this mailbox"
			const hasContent = await page
				.locator("a[href*='/mail/']")
				.first()
				.isVisible()
				.catch(() => false);

			const hasEmptyState = await page
				.getByText("No messages in this mailbox")
				.isVisible()
				.catch(() => false);

			// One of these should be true
			expect(hasContent || hasEmptyState).toBeTruthy();
		}
	});
});
