import { expect, test } from "./fixtures/account-setup";

/**
 * Mail layout baselines:
 *   - `/mail` empty state (no mailbox selected)
 *   - `/mail/<inboxId>` mailbox list
 *   - `/mail/<inboxId>?selectedMessageId=<msg>` thread open
 *
 * Time/date strings (relative-formatted "Yesterday", "8:01 AM" etc) are
 * masked so the suite isn't flaky against wall-clock-based seed data.
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
		await expect(page).toHaveScreenshot("mail-mailbox-list.png", {
			mask: [page.getByTestId("thread-time")],
		});
	});

	test("thread open", async ({ page, inboxId, sampleMessageId }) => {
		await page.goto(`/mail/${inboxId}?selectedMessageId=${sampleMessageId}`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(500);
		await expect(page).toHaveScreenshot("mail-thread-open.png", {
			mask: [page.getByTestId("thread-time"), page.getByTestId("message-date")],
		});
	});

	/**
	 * Phone-only baseline that asserts the chrome at the very top of the
	 * mobile thread view. The `useSetHideHeader(true)` gate in
	 * `ConversationView` only fires when `isDesktop=false && has onBack &&
	 * no inline-compose`, which on the test viewport (iPhone 13 / 390×844
	 * → `useIsDesktop=false`) is the route reached via `selectedMessageId`
	 * (mobile-only branch in `routes/mail/$mailboxId.tsx` passes `onBack`).
	 *
	 * The full-page `mail-thread-open.png` snapshot above also covers
	 * this state, but with `maxDiffPixelRatio: 0.05` against a 390×844
	 * canvas (~329k pixels) a re-appearing 48px header (~5.7% of pixels)
	 * sits right on the threshold and can slip through. This snapshot
	 * clips to the top 120px band — the only area whose pixels move when
	 * the gate stops firing — and runs with a tighter
	 * `maxDiffPixelRatio: 0.04` (vs the suite's 0.05). The clip
	 * concentrates the diff: a re-appearing 48px Header is ~40% of the
	 * 120px band, well over the threshold. The 4% headroom absorbs
	 * font-rendering noise between local (capture) and CI (assert)
	 * Chromium runs (~3%) — see issue #173.
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
			mask: [page.getByTestId("message-date")],
			maxDiffPixelRatio: 0.04,
		});
	});
});
