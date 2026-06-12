import { expect, test } from "./fixtures/account-setup.js";

/**
 * Search behaviour regressions for #538 (clear button) and #539
 * (search hides the reading pane / compose window).
 */
test.describe("Search", () => {
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

	// #538 — typing a query shows the X clear button; clicking it empties the
	// input, removes `q` from the URL, and returns the list to its normal state.
	test("clear button empties search input and removes q from URL (#538)", async ({
		page,
	}) => {
		const searchInput = page.getByRole("textbox", { name: /search mail/i });
		await searchInput.fill("welcome");

		// X button must appear once there is a value
		const clearButton = page.getByRole("button", { name: /clear search/i });
		await expect(clearButton).toBeVisible({ timeout: 5_000 });

		await clearButton.click();

		// Input is empty
		await expect(searchInput).toHaveValue("");

		// URL must not carry a `q` param
		await expect(page).not.toHaveURL(/[?&]q=/);

		// Clear button is gone (no value to clear)
		await expect(clearButton).not.toBeVisible();

		// Normal list is back — thread rows are visible
		await expect(
			page.locator("a[href*='selectedMessageId']").first(),
		).toBeVisible({ timeout: 10_000 });
	});

	// #539 — while a search query is active the reading pane must be hidden,
	// even when a message was previously selected.
	test("active search hides the reading pane (#539)", async ({ page }) => {
		// Open a message so the reading pane (article) is visible
		const firstRow = page.locator("a[href*='selectedMessageId']").first();
		await firstRow.click();
		await page.waitForURL(/selectedMessageId=/);
		await expect(page.getByRole("article")).toBeVisible({ timeout: 10_000 });

		// Start typing in the search bar — reading pane must disappear immediately
		const searchInput = page.getByRole("textbox", { name: /search mail/i });
		await searchInput.fill("w");

		// The article (reading pane) must no longer be present
		await expect(page.getByRole("article")).not.toBeVisible({ timeout: 5_000 });

		// selectedMessageId is cleared from the URL
		await expect(page).not.toHaveURL(/selectedMessageId=/, { timeout: 5_000 });
	});
});
