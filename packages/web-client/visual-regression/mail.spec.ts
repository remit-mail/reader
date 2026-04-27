import { expect, test } from "./fixtures/account-setup";

/**
 * Mail layout baselines:
 *   - `/mail` empty state (no mailbox selected)
 *   - `/mail/<inboxId>` mailbox list
 *   - `/mail/<inboxId>?selectedMessageId=<msg>` thread open
 *
 * Time/date labels are byte-stable thanks to the fixed clock
 * (REMIT_FAKE_NOW, set in `playwright.visual.config.ts`), so the old
 * per-cell mask rectangles are no longer needed.
 */
test.describe("visual: mail", () => {
	test("empty mail route", async ({ page }) => {
		await page.goto("/mail");
		await page.waitForLoadState("networkidle");
		await expect(page).toHaveScreenshot("mail-empty.png");
	});

	test("mailbox list", async ({ page, inboxId }) => {
		await page.goto(`/mail/${inboxId}`);
		// Wait for either the message list rows or the empty state to land.
		await page.waitForLoadState("networkidle");
		// Give virtualizer a moment to settle.
		await page.waitForTimeout(500);
		await expect(page).toHaveScreenshot("mail-mailbox-list.png");
	});

	test("thread open", async ({ page, inboxId, sampleMessageId }) => {
		await page.goto(`/mail/${inboxId}?selectedMessageId=${sampleMessageId}`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(500);
		await expect(page).toHaveScreenshot("mail-thread-open.png");
	});

	/**
	 * Phone-only baseline asserting the top-band chrome of the mobile
	 * thread view. With #198 the bottom nav is gone and the global
	 * Header now stays mounted in the thread view too — the inbox
	 * label sits next to the hamburger so the user has constant
	 * orientation. Clipped to the top 120px band so the 48px header
	 * dominates the assertion area, well clear of the suite's
	 * threshold.
	 *
	 * Tablet/desktop run the same spec but the clip-band assertion is
	 * skipped because the desktop layout has its own in-pane subject
	 * header (covered by `mail-thread-open.png`).
	 */
	test("mobile thread top chrome", async ({
		page,
		inboxId,
		sampleMessageId,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "phone",
			"Top-chrome clip is phone-specific; tablet/desktop have a different header layout",
		);
		await page.goto(`/mail/${inboxId}?selectedMessageId=${sampleMessageId}`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(500);
		await expect(page).toHaveScreenshot("mail-thread-mobile-top-chrome.png", {
			clip: { x: 0, y: 0, width: 390, height: 120 },
		});
	});
});
