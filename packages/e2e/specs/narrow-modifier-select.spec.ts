/**
 * Modifier selection below the desktop width (#586).
 *
 * A modifier can only come from a real keyboard, so shift and cmd build a
 * selection at every width. Under 1024px the list renders the swipe row, whose
 * press is a pointer gesture that opens the message on release — a modified
 * click there used to fall straight through to the open. 900px is the window
 * that made it visible: a half-screen browser, or a tablet with a keyboard.
 *
 * Read-only, so it leaves the shared inbox exactly as it found it.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const HALF_SCREEN = { width: 900, height: 844 };
test.use({ viewport: HALF_SCREEN });

const rows = (page: Page): Locator => page.locator("[data-message-row]");

const selectionCount = (page: Page): Locator =>
	page.locator("[data-selection-count]");

test.describe("Modifier selection under 1024px", () => {
	test.beforeEach(async ({ page, run }) => {
		await page.goto(`/mail/${run.inboxId}`);
		await expect(rows(page)).toHaveCount(run.seededSubjects.length, {
			timeout: 30_000,
		});
	});

	test("shift-click starts and extends a selection instead of opening", async ({
		page,
	}) => {
		await rows(page)
			.nth(0)
			.click({ modifiers: ["Shift"] });
		await expect(selectionCount(page)).toHaveText("1 message selected");

		await rows(page)
			.nth(2)
			.click({ modifiers: ["Shift"] });
		await expect(selectionCount(page)).toHaveText("3 messages selected");

		await expect(page).not.toHaveURL(MAILBOX_THREAD_URL);
	});

	test("cmd/ctrl-click adds and removes single rows", async ({ page }) => {
		await rows(page)
			.nth(0)
			.click({ modifiers: ["ControlOrMeta"] });
		await expect(selectionCount(page)).toHaveText("1 message selected");

		await rows(page)
			.nth(2)
			.click({ modifiers: ["ControlOrMeta"] });
		await expect(selectionCount(page)).toHaveText("2 messages selected");

		await rows(page)
			.nth(2)
			.click({ modifiers: ["ControlOrMeta"] });
		await expect(selectionCount(page)).toHaveText("1 message selected");

		await expect(page).not.toHaveURL(MAILBOX_THREAD_URL);
	});

	test("an unmodified tap still opens the message", async ({ page }) => {
		await rows(page).nth(0).click();

		await page.waitForURL(MAILBOX_THREAD_URL);
		await expect(selectionCount(page)).toBeHidden();
	});
});
