/**
 * Ported from the retired seeded smoke suite. The assertions are unchanged —
 * they were already written against ARIA roles — but the mailboxes they find
 * now come from a real sync rather than rows written into the database.
 */
import { expect, test } from "../src/fixtures.js";

const openInbox = async (page: import("@playwright/test").Page) => {
	await page.goto("/mail");
	const sidebar = page.getByRole("navigation", {
		name: "Mailboxes",
		exact: true,
	});
	await expect(sidebar).toBeVisible({ timeout: 20_000 });
	const inbox = sidebar.getByRole("link", { name: /inbox/i });
	await expect(inbox).toBeVisible({ timeout: 10_000 });
	return { sidebar, inbox };
};

test.describe("Mailbox navigation", () => {
	test("the sidebar lists the synced mailboxes", async ({ page }) => {
		const { sidebar } = await openInbox(page);
		await expect(sidebar.getByRole("link", { name: /sent/i })).toBeVisible();
		await expect(sidebar.getByRole("link", { name: /trash/i })).toBeVisible();
	});

	test("opening a mailbox loads its messages and puts it in the URL", async ({
		page,
		run,
	}) => {
		const { inbox } = await openInbox(page);
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		// Navigating has to deliver the mailbox's contents, not just its route.
		await expect(page.locator("a[href*='selectedMessageId']")).toHaveCount(
			run.seededSubjects.length,
			{ timeout: 20_000 },
		);
	});

	test("moving between mailboxes is navigable with the back button", async ({
		page,
	}) => {
		const { sidebar, inbox } = await openInbox(page);
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);
		const inboxUrl = page.url();

		await sidebar.getByRole("link", { name: /sent/i }).click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);
		expect(page.url()).not.toBe(inboxUrl);

		await page.goBack();
		await expect(page).toHaveURL(inboxUrl);
	});
});
