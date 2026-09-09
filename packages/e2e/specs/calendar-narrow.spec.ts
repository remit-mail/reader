/**
 * The calendar on a phone (#1033).
 *
 * At this width the nav is a slide-over with nothing else to open it, so the
 * hamburger in the calendar's own header is the only way back to the mail —
 * without it the calendar is a room with the door painted on. And the crossing
 * is a navigation like any other, so it obeys the rule
 * `routing/calendar-fragment.test.ts` states: below desktop the rail is a
 * full-screen drawer belonging to the screen it was opened for, so going
 * somewhere leaves it behind rather than covering wherever the reader lands.
 */
import { expect, test } from "../src/fixtures.js";
import { MAILBOX_URL } from "../src/urls.js";

/** A phone, and the one tier where the nav has no pane of its own. */
test.use({ viewport: { width: 411, height: 759 }, timezoneId: "UTC" });

/** A fixed Monday, so the week the address opens is not the week today is in. */
const WEEK = "2032-02-09";

const CALENDAR_WEEK_URL = /\/calendar\/week\/\d{4}-\d{2}-\d{2}(\?|#|$)/;

test.describe("The calendar on a phone", () => {
	test("keeps the way back to the mail, and leaves the drawer behind on the way", async ({
		page,
		run,
	}) => {
		test.setTimeout(120_000);

		await page.goto(`/calendar/week/${WEEK}`);

		const openNav = page.getByRole("button", { name: "Open folders" });
		await expect(openNav).toBeVisible({ timeout: 30_000 });
		await openNav.click();

		const folders = page.getByRole("dialog", { name: "Folders" });
		await expect(folders).toBeVisible({ timeout: 15_000 });
		await expect(page).toHaveURL(/#nav$/);

		// Going somewhere is what closes it: the slide-over is not a panel the
		// reader takes with them.
		await folders.getByRole("link", { name: /inbox/i }).click();
		await page.waitForURL(MAILBOX_URL);
		await expect(folders).toHaveCount(0);
		await expect(page).not.toHaveURL(/#nav/);

		// A reader arriving on their mail with the rail in the address, which is
		// the fragment the desktop tier hands them.
		await page.goto(`/mail/${run.inboxId}#intelligence`);
		await expect(page).toHaveURL(/#intelligence$/);

		await page
			.getByRole("button", { name: "Menu", exact: true })
			.first()
			.click({ timeout: 30_000 });
		await expect(page.getByRole("dialog", { name: "Folders" })).toBeVisible({
			timeout: 15_000,
		});
		await page
			.getByRole("dialog", { name: "Folders" })
			.getByRole("link", { name: "Calendar", exact: true })
			.click();

		// The calendar the reader lands on is a calendar, and the drawer they came
		// through is not on top of it: at this tier the rail is not a pane, so
		// nothing carries it across.
		await page.waitForURL(CALENDAR_WEEK_URL);
		await expect(
			page.getByRole("button", { name: "Open folders" }),
		).toBeVisible({ timeout: 30_000 });
		await expect(page).not.toHaveURL(/#/);
	});
});
