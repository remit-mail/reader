import { expect, test } from "./fixtures/account-setup.js";

/**
 * Phone-tier search regressions (follow-up to #1025).
 *
 * BUG 1 — inbox: with an active query the search bar must stay visible.
 * BUG 2 — daily brief: tapping a search result must open the message.
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.describe("Mobile search", () => {
	test.use({ viewport: MOBILE_VIEWPORT });

	test("BUG2 brief: tapping a search result opens the message", async ({
		page,
	}) => {
		await page.goto("/mail");

		// The brief header magnifier opens the full-screen search takeover.
		const magnifier = page.getByRole("button", { name: "Search", exact: true });
		await expect(magnifier).toBeVisible({ timeout: 15_000 });
		await magnifier.click();

		const searchInput = page.getByRole("textbox", { name: /search mail/i });
		await expect(searchInput).toBeVisible({ timeout: 5_000 });
		await searchInput.fill("weekend");

		// The seeded "Weekend plans?" message must surface as a result row.
		const resultRow = page.getByRole("button", { name: /weekend plans/i });
		await expect(resultRow).toBeVisible({ timeout: 10_000 });
		await resultRow.click();

		// Tapping the result must open the conversation.
		await expect(page).toHaveURL(/selectedMessageId=/, { timeout: 10_000 });
		await expect(page.getByRole("article")).toBeVisible({ timeout: 10_000 });
	});

	test("BUG1 inbox: search bar stays visible while a query is active", async ({
		page,
	}) => {
		await page.goto("/mail");

		const menuButton = page.getByRole("button", { name: "Menu" });
		await expect(menuButton).toBeVisible({ timeout: 15_000 });
		await menuButton.click();

		const sidebar = page.getByRole("navigation", { name: "Mailboxes" });
		const inbox = sidebar.getByRole("link", { name: /inbox/i });
		await expect(inbox).toBeVisible({ timeout: 10_000 });
		await inbox.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		await expect(
			page.locator("a[href*='selectedMessageId']").first(),
		).toBeVisible({ timeout: 10_000 });

		// Open the search takeover and run a query.
		const magnifier = page.getByRole("button", { name: "Search", exact: true });
		await expect(magnifier).toBeVisible({ timeout: 5_000 });
		await magnifier.click();

		const searchInput = page.getByRole("textbox", { name: /search mail/i });
		await searchInput.fill("invoice");

		const resultRow = page.getByRole("button", { name: /invoice/i });
		await expect(resultRow).toBeVisible({ timeout: 10_000 });
		await resultRow.click();

		// In the thread now — go back to the list; the query is still active.
		await expect(page).toHaveURL(/selectedMessageId=/, { timeout: 10_000 });
		const back = page.getByRole("button", { name: /back to messages/i });
		await expect(back).toBeVisible({ timeout: 10_000 });
		await back.click();
		await page.waitForURL(/\/mail\/[a-z0-9]+(?!\?.*selectedMessageId)/);

		// The active query must keep the search bar on screen (not collapsed to a
		// magnifier). #1025 fixed this for the brief; the inbox must match.
		await expect(
			page.getByRole("textbox", { name: /search mail/i }),
		).toBeVisible({ timeout: 5_000 });
	});
});
