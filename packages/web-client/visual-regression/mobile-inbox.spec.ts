import { expect, test } from "./fixtures/account-setup";

/**
 * Phone-only visual baselines for mobile touch interactions (#235).
 * These capture the current state of the mobile UI after the full
 * stacked PR series: long-press multi-select, swipe actions,
 * pull-to-refresh, compose sheet, and keyboard collapse.
 *
 * All tests skip on tablet/desktop viewports.
 */
test.describe("visual: mobile inbox", () => {
	test("inbox-row-idle", async ({ page, inboxId }, testInfo) => {
		test.skip(
			testInfo.project.name !== "phone",
			"Phone-only baseline for mobile inbox row",
		);
		await page.goto(`/mail/${inboxId}`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(500);
		await expect(page).toHaveScreenshot("inbox-row-idle.png");
	});

	test("inbox-multi-select-armed", async ({ page, inboxId }, testInfo) => {
		test.skip(
			testInfo.project.name !== "phone",
			"Phone-only baseline for multi-select top bar",
		);
		await page.goto(`/mail/${inboxId}`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(500);

		// Long-press the first message row to enter multi-select mode.
		// The long-press threshold is 500ms; hold for 600ms to be safe.
		const firstRow = page.locator("[data-message-row]").first();
		await firstRow.waitFor({ state: "visible" });

		const box = await firstRow.boundingBox();
		if (!box) throw new Error("Could not locate first message row");

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.waitForTimeout(600);
		await page.mouse.up();

		// Wait for the selection UI to settle
		await page.waitForTimeout(300);

		await expect(page).toHaveScreenshot("inbox-multi-select-armed.png");
	});
});
