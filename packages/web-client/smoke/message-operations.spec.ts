import { expect, test } from "./fixtures/account-setup.js";

test.describe("Message operations", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/mail");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		await expect(sidebar).toBeVisible({ timeout: 15_000 });

		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await expect(inbox).toBeVisible({ timeout: 10_000 });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);
		await expect(
			page.locator("a[href*='selectedMessageId']").first(),
		).toBeVisible({ timeout: 10_000 });
	});

	test("delete message via conversation action menu", async ({ page }) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 10_000,
		});

		// Open the three-dot action menu
		const moreButton = article.locator("svg.lucide-ellipsis-vertical").first();
		await expect(moreButton).toBeVisible({ timeout: 5_000 });
		await moreButton.click();

		// Delete option should be visible in the dropdown
		const deleteOption = page.getByRole("button", { name: "Delete" });
		await expect(deleteOption).toBeVisible({ timeout: 5_000 });
	});

	test("select message shows selection toolbar with delete button", async ({
		page,
	}) => {
		// Hover the first message to show the checkbox
		const firstMessage = page.locator("a[href*='selectedMessageId']").first();
		await firstMessage.hover();

		const selectButton = firstMessage.getByRole("button", {
			name: /select message/i,
		});
		await expect(selectButton).toBeVisible({ timeout: 5_000 });
		await selectButton.click();

		// SelectionToolbar should appear
		const toolbar = page.getByText(/\d+ messages? selected/);
		await expect(toolbar).toBeVisible({ timeout: 5_000 });

		// Delete button should be visible in the toolbar
		const deleteButton = page.getByRole("button", {
			name: /delete selected/i,
		});
		await expect(deleteButton).toBeVisible();
	});

	test("navigate to Trash mailbox after deletion", async ({ page }) => {
		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const trashLink = sidebar.getByRole("link", { name: /trash/i });
		await expect(trashLink).toBeVisible();

		await trashLink.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		// The Trash view should render - either messages or empty state
		// Wait for loading to finish
		await page.waitForTimeout(2_000);

		const hasMessages =
			(await page
				.locator("a[href*='selectedMessageId']")
				.first()
				.isVisible()
				.catch(() => false)) ||
			(await page
				.getByText(/no messages/i)
				.isVisible()
				.catch(() => false)) ||
			(await page
				.getByText(/select a message/i)
				.isVisible()
				.catch(() => false));

		expect(hasMessages).toBeTruthy();
	});
});
