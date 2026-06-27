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
		// The expanded message's per-message action bar mounts asynchronously
		// once the thread resolves. Wait for its delete button so the clipped
		// band is captured in the settled action-bar state — otherwise capture
		// and assert race the pre-mount sender card against the mounted action
		// bar and never agree.
		await expect(
			page.getByRole("button", { name: "Move to Trash" }).first(),
		).toBeVisible();
		await expect(page).toHaveScreenshot("mail-thread-mobile-top-chrome.png", {
			clip: { x: 0, y: 0, width: 390, height: 120 },
		});
	});

	/**
	 * Phone-only baseline guarding the mobile thread action bar at
	 * narrow widths (iPhone-13 = 390×844). Two regressions in #218:
	 *
	 *   1. Forward used to orphan onto a second row at <640px because
	 *      [Back][Reply][Reply all][Forward] with text labels exceeded
	 *      the available width. Labels now collapse to icon-only below
	 *      the `sm:` breakpoint so all four sit on a single row.
	 *   2. Empty space below the action bar appeared when scrolling
	 *      because layout used `100vh` (initial viewport, URL bar
	 *      visible) — Android Chromium collapses the URL bar on scroll
	 *      and the page becomes "too tall". Swap to `100dvh` /
	 *      `h-dvh` keeps the layout sized to the dynamic viewport.
	 *
	 * Clipped to the bottom 200px band so the action bar dominates
	 * the assertion area. Tablet/desktop have a different layout
	 * (text labels visible, sticky bottom in the right pane only).
	 */
	test("mobile thread action bar fits one row", async ({
		page,
		inboxId,
		sampleMessageId,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "phone",
			"Action-bar wrap is phone-specific; tablet/desktop have room for text labels",
		);
		await page.goto(`/mail/${inboxId}?selectedMessageId=${sampleMessageId}`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(500);
		const viewport = page.viewportSize();
		if (!viewport) throw new Error("viewport unavailable");
		await expect(page).toHaveScreenshot("mail-thread-mobile-action-bar.png", {
			clip: {
				x: 0,
				y: viewport.height - 200,
				width: viewport.width,
				height: 200,
			},
		});
	});

	/**
	 * Regression for #212 — clicking a stale row used to surface the raw
	 * `Message not found: <id>` string instead of a graceful empty state.
	 *
	 * Visiting an inbox URL with `selectedMessageId` pointing at a message
	 * that was never seeded simulates the post-permanent-delete state: the
	 * thread row is gone (excluded by the new `excludeDeleted: true`
	 * default) but the URL still references the now-vanished message ID.
	 *
	 * Desktop two-pane layout: the right pane must show the empty
	 * "Select a message to read" state — never the raw error string.
	 *
	 * The non-existent ID is a deterministic placeholder, so the test is
	 * reproducible across runs and across machines.
	 */
	test("deleted message URL falls back to empty state", async ({
		page,
		inboxId,
	}, testInfo) => {
		test.skip(
			testInfo.project.name === "phone",
			"Mobile collapses to single-pane; the empty state is the desktop two-pane behavior covered here",
		);
		const deletedMessageId = "alice-deleted-aaaaaaaaaaaaaaa";
		await page.goto(`/mail/${inboxId}?selectedMessageId=${deletedMessageId}`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(500);

		// Belt: the raw "Message not found" error string from the backend
		// must NOT surface to the user — that's the literal #212 bug.
		await expect(page.getByText(/Message not found:/i)).toHaveCount(0);

		await expect(page).toHaveScreenshot("mail-deleted-message-empty.png");
	});
});
