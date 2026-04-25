import { expect, test } from "@playwright/test";

test.describe("visual: outbox", () => {
	test("empty outbox", async ({ page }) => {
		await page.goto("/mail/outbox");
		await page.waitForLoadState("networkidle");
		await expect(page).toHaveScreenshot("outbox-empty.png");
	});
});
