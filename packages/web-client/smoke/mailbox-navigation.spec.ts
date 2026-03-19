import { expect, test } from "./fixtures/account-setup.js";

test.describe("Mailbox navigation", () => {
	test("displays mailbox sidebar with INBOX", async ({ page }) => {
		await page.goto("/mail");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		await expect(sidebar).toBeVisible({ timeout: 15_000 });

		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await expect(inbox).toBeVisible({ timeout: 10_000 });
	});

	test("clicking a mailbox loads its messages and updates URL", async ({
		page,
	}) => {
		await page.goto("/mail");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		await expect(sidebar).toBeVisible({ timeout: 15_000 });

		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await expect(inbox).toBeVisible({ timeout: 10_000 });
		await inbox.click();

		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		// Wait for message list to load - thread items should appear
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await expect(messageLink).toBeVisible({ timeout: 10_000 });
	});

	test("navigating between mailboxes changes the URL", async ({ page }) => {
		await page.goto("/mail");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		await expect(sidebar).toBeVisible({ timeout: 15_000 });

		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);
		const inboxUrl = page.url();

		// Click Sent mailbox
		const sentLink = sidebar.getByRole("link", { name: /sent/i });
		await expect(sentLink).toBeVisible();
		await sentLink.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);
		const sentUrl = page.url();

		expect(sentUrl).not.toBe(inboxUrl);

		await page.goBack();
		await expect(page).toHaveURL(inboxUrl);
	});
});
