/**
 * The full-screen fatal page, which is the app's last resort and never the
 * right answer to a request that worked (#921, #924).
 */
import { expect, type Page } from "@playwright/test";

/**
 * Assert the fatal overlay is absent, optionally after a quiet window.
 *
 * The overlay is raised by whatever is polling behind the surface, so a read
 * taken the instant an action settles is too early to say it stayed absent.
 * The window is the caller's: long enough that a poll that had not stopped
 * would have run again inside it.
 */
export const expectNoFatalOverlay = async (
	page: Page,
	quietWindowMs = 0,
): Promise<void> => {
	if (quietWindowMs > 0) await page.waitForTimeout(quietWindowMs);
	await expect(page.getByTestId("fatal-error-overlay")).toHaveCount(0);
};
