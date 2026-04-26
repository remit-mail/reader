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
	 * Phone-only baseline that asserts the chrome at the very top of the
	 * mobile thread view. The `useSetHideHeader(true)` gate in
	 * `ConversationView` only fires when `isDesktop=false && has onBack &&
	 * no inline-compose`, which on the test viewport (iPhone 13 / 390×844
	 * → `useIsDesktop=false`) is the route reached via `selectedMessageId`
	 * (mobile-only branch in `routes/mail/$mailboxId.tsx` passes `onBack`).
	 *
	 * Clips to the top 120px band so a re-appearing 48px header lands as
	 * ~40% of the assertion area, well clear of the suite's 1% threshold.
	 *
	 * Tablet/desktop run the same spec but the assertion is skipped
	 * because the gate is desktop-suppressed there (`useIsDesktop=true`).
	 */
	test("mobile thread no-header chrome", async ({
		page,
		inboxId,
		sampleMessageId,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "phone",
			"Header-hide gate only fires on the phone (<768px) viewport",
		);
		await page.goto(`/mail/${inboxId}?selectedMessageId=${sampleMessageId}`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(500);
		await expect(page).toHaveScreenshot("mail-thread-mobile-no-header.png", {
			clip: { x: 0, y: 0, width: 390, height: 120 },
		});
	});
});
