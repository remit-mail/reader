import { expect, test } from "./fixtures/account-setup.js";

test.describe("Mailbox navigation", () => {
	test("displays mailbox sidebar with INBOX", async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		// The sidebar has aria-label="Mailboxes" on the nav element
		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		await expect(sidebar).toBeVisible();

		// INBOX should appear in the sidebar as a link
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await expect(inbox).toBeVisible();
	});

	test("clicking a mailbox loads its messages and updates URL", async ({
		page,
	}) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await inbox.click();

		// URL should contain a mailbox ID segment after /mail/
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		// Wait for message list to load (loading skeleton should disappear)
		await expect(page.getByText("Loading...")).toBeHidden({ timeout: 10_000 });
	});

	test("navigating between mailboxes changes the URL", async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });

		// Click INBOX
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);
		const inboxUrl = page.url();

		// Look for another mailbox (Sent, Trash, Drafts, etc.)
		const otherMailbox = sidebar
			.getByRole("link")
			.filter({ hasNot: page.getByText(/inbox/i) })
			.first();
		const otherMailboxVisible = await otherMailbox.isVisible();

		if (otherMailboxVisible) {
			await otherMailbox.click();
			await page.waitForURL(/\/mail\/[a-z0-9]+/);
			const otherUrl = page.url();

			// URLs should be different mailbox IDs
			expect(otherUrl).not.toBe(inboxUrl);

			// Go back should return to INBOX
			await page.goBack();
			await expect(page).toHaveURL(inboxUrl);
		}
	});
});
