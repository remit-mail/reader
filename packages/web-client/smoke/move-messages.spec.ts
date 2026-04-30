import { expect, test } from "./fixtures/account-setup.js";

test.describe("Move messages (#236)", () => {
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

	test("desktop bulk: selecting messages reveals the Move button in the toolbar", async ({
		page,
	}) => {
		const firstMessage = page.locator("a[href*='selectedMessageId']").first();
		await firstMessage.hover();

		const selectButton = firstMessage.getByRole("button", {
			name: /select message/i,
		});
		await expect(selectButton).toBeVisible({ timeout: 5_000 });
		await selectButton.click();

		await expect(page.getByText(/\d+ messages? selected/)).toBeVisible({
			timeout: 5_000,
		});

		const moveButton = page.getByRole("button", {
			name: /move selected messages/i,
		});
		await expect(moveButton).toBeVisible({ timeout: 5_000 });
	});

	test("desktop bulk: opening the Move popover shows the always-on filter and excludes Drafts/Sent", async ({
		page,
	}) => {
		const firstMessage = page.locator("a[href*='selectedMessageId']").first();
		await firstMessage.hover();

		await firstMessage.getByRole("button", { name: /select message/i }).click();
		await expect(page.getByText(/\d+ messages? selected/)).toBeVisible({
			timeout: 5_000,
		});

		const moveButton = page.getByRole("button", {
			name: /move selected messages/i,
		});
		await moveButton.click();

		const filterInput = page.getByRole("searchbox", {
			name: /filter folders/i,
		});
		await expect(filterInput).toBeVisible({ timeout: 5_000 });

		// At least one destination row must render — usually Trash + user folders.
		const destinationOptions = page.getByRole("option");
		await expect(destinationOptions.first()).toBeVisible({ timeout: 5_000 });

		// Drafts and Sent must NOT appear as destinations.
		const draftsOption = page.getByRole("option", {
			name: /^Move to Drafts/i,
		});
		const sentOption = page.getByRole("option", { name: /^Move to Sent/i });
		await expect(draftsOption).toHaveCount(0);
		await expect(sentOption).toHaveCount(0);
	});

	test("per-message: the Move trigger is rendered next to the conversation overflow", async ({
		page,
	}) => {
		const messageLink = page.locator("a[href*='selectedMessageId']").first();
		await messageLink.click();
		await page.waitForURL(/selectedMessageId=/);

		const article = page.getByRole("article");
		await expect(article).toBeVisible({ timeout: 10_000 });
		await expect(article.locator(".animate-pulse")).toBeHidden({
			timeout: 10_000,
		});

		const moveTrigger = article.getByRole("button", {
			name: /move this message/i,
		});
		await expect(moveTrigger).toBeVisible({ timeout: 10_000 });
	});
});
