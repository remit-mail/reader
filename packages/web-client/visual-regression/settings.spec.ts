import { expect, test } from "@playwright/test";

test.describe("visual: settings", () => {
	test("accounts page", async ({ page }) => {
		await page.goto("/settings/accounts");
		await page.waitForLoadState("networkidle");
		// Give the SuspenseQuery + form a moment.
		await page.waitForTimeout(500);
		await expect(page).toHaveScreenshot("settings-accounts.png");
	});
});
