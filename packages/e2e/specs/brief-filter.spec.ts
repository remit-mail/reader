/**
 * The daily brief's filter surface on desktop (#559).
 *
 * The brief's list header carries the same filter caret every other list view
 * carries, and the caret opens a real panel: category pills, attribute chips,
 * and — on a multi-account instance — the account source row. Toggling a chip
 * narrows the brief's own grouped sections.
 *
 * The brief used to render a copy of the kit's list body with the filter control
 * removed, and no panel for the caret to open, so the caret rendered nothing and
 * the brief could not be filtered at any desktop width.
 *
 * "Unread" is the chip under test because its input is set on the server at
 * APPEND time: one seeded message arrives already `\Seen`, the other does not,
 * so what the chip must hide is decided before the app has seen either.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";

const DESKTOP = { width: 1512, height: 864 };

const briefRow = (page: Page, subject: string): Locator =>
	page.locator("[data-message-row]").filter({ hasText: subject });

const filterCaret = (page: Page): Locator =>
	page.getByRole("button", { name: "Expand filters" });

const chip = (page: Page, label: string): Locator =>
	page.getByRole("button", { name: label, exact: true });

test.describe("Daily brief filter surface (#559)", () => {
	test.use({ viewport: DESKTOP });

	const tag = `brieffilter${Date.now()}`;
	const readSubject = `Brief filter read ${tag}`;
	const unreadSubject = `Brief filter unread ${tag}`;

	test.beforeEach(async ({ run, api }) => {
		await appendMessages(run.imapUser, [
			{ subject: readSubject, flags: ["\\Seen"] },
			{ subject: unreadSubject },
		]);
		await api.triggerSync(run.accountId);
	});

	test.afterEach(async ({ api, run }) => {
		const leftover = await api.searchMatchingMessageIds(run.inboxId, tag);
		if (leftover.length > 0) await api.deleteMessages(leftover);
	});

	test("the header caret opens a panel that narrows the brief", async ({
		page,
	}) => {
		await page.goto("/mail");
		await expect(async () => {
			await page.reload();
			for (const subject of [readSubject, unreadSubject]) {
				await expect(briefRow(page, subject)).toBeVisible({ timeout: 5_000 });
			}
		}).toPass({ timeout: 60_000 });

		await expect(filterCaret(page)).toBeVisible();
		await filterCaret(page).click();

		// The panel the caret opens is the brief's own: the category scope and the
		// attribute chips, in one place.
		await expect(chip(page, "Newsletters")).toBeVisible();
		await expect(chip(page, "Has attachment")).toBeVisible();

		await chip(page, "Unread").click();
		await expect(briefRow(page, unreadSubject)).toBeVisible();
		await expect(briefRow(page, readSubject)).toHaveCount(0);

		// Clearing restores what the chip hid, from the same panel.
		await chip(page, "Clear").click();
		await expect(briefRow(page, readSubject)).toBeVisible();
		await expect(briefRow(page, unreadSubject)).toBeVisible();
	});
});
