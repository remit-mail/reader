import { expect, test } from "./fixtures/account-setup";

/**
 * Compose surface baseline. We open compose programmatically by hitting
 * a mailbox route and triggering the composer through the keyboard
 * shortcut "c", which the existing app exposes.
 *
 * The mailbox list is still partially visible behind the composer on
 * tablet/desktop, so mask the time labels there too.
 */
test.describe("visual: compose", () => {
	test("new compose form", async ({ page, inboxId }) => {
		await page.goto(`/mail/${inboxId}`);
		await page.waitForLoadState("networkidle");
		// "c" opens compose (hotkey defined in routes/mail/$mailboxId.tsx).
		await page.keyboard.press("c");
		// Wait for the compose body fallback or the editor itself.
		await page.waitForTimeout(1500);
		await expect(page).toHaveScreenshot("compose-new.png", {
			mask: [page.getByTestId("thread-time")],
		});
	});
});
