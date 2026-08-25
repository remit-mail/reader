/**
 * The compose shortcut starts a message from every list (#724).
 *
 * `c` is defined in the keymap, but it was wired only in MailboxPane's handler
 * table — so on the brief, on Flagged and in the outbox the key did nothing.
 * The dispatcher was never wrong; the action had no listener.
 */

import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };

test.describe("Compose shortcut (#724)", () => {
	test.use({ viewport: DESKTOP });

	test("`c` on the brief opens compose", async ({ page }) => {
		await page.goto("/mail");
		await expect(
			page.getByRole("navigation", { name: "Mailboxes" }),
		).toBeVisible({
			timeout: 20_000,
		});

		await page.keyboard.press("c");

		await expect(page.getByTestId("compose-body")).toBeVisible({
			timeout: 30_000,
		});
	});
});
