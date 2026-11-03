/**
 * Selecting a range on the week grid and creating an event from the
 * quick-create popup beside it. What a save wrote is read back from the API.
 */
import type { Page } from "@playwright/test";
import { waitFor } from "../src/api.js";
import {
	amsterdam,
	CALENDAR_ZONE,
	deleteEventsByPrefix,
	weekDay,
} from "../src/calendar.js";
import { clickSlot, dragRange } from "../src/calendar-grid.js";
import { expect, test } from "../src/fixtures.js";

test.use({
	viewport: { width: 1440, height: 900 },
	timezoneId: CALENDAR_ZONE,
	locale: "en-GB",
});

const PREFIX = "e2e quick";
const week = `/calendar/week/${weekDay(0)}`;
const quick = (page: Page) => page.getByRole("dialog", { name: "New event" });
const block = (page: Page) => page.locator("[data-draft-block]");
const title = (page: Page) => quick(page).getByLabel("Title");

const cleanUp = () => deleteEventsByPrefix(PREFIX);
test.afterAll(cleanUp);

test("a drag opens quick-create on the range, and Enter saves the event there", async ({
	page,
	api,
}) => {
	await page.goto(week);
	await dragRange(page, 5, 11 * 60, 12 * 60);
	await expect(quick(page)).toBeVisible();
	await expect(quick(page).getByLabel("Start time")).toHaveValue("11:00");
	await expect(quick(page).getByLabel("End time")).toHaveValue("12:15");
	await expect(block(page)).toContainText("New event");
	await expect(title(page)).toBeFocused();

	await title(page).fill(`${PREFIX} saved`);
	await title(page).press("Enter");
	await expect(quick(page)).toHaveCount(0);
	await expect(
		page.locator("[data-event-id]", { hasText: `${PREFIX} saved` }),
	).toBeFocused();

	const events = await waitFor(
		() =>
			api.listCalendarEvents(
				amsterdam(weekDay(5), "00:00"),
				amsterdam(weekDay(6), "00:00"),
			),
		(items) => items.some((item) => item.summary === `${PREFIX} saved`),
		{ what: "the quick-created event on the server" },
	);
	const saved = events.find((item) => item.summary === `${PREFIX} saved`);
	expect(new Date(saved?.start ?? "").toISOString()).toBe(
		new Date(amsterdam(weekDay(5), "11:00")).toISOString(),
	);
});

test("an outside click after typing clears popup and range, and the next click starts fresh", async ({
	page,
}) => {
	await page.goto(week);
	await dragRange(page, 2, 9 * 60, 10 * 60);
	await title(page).fill("Throw me away");
	await clickSlot(page, 0, 18 * 60);
	await expect(quick(page)).toHaveCount(0);
	await expect(block(page)).toHaveCount(0);
	await expect(page.getByText(/undo/i)).toHaveCount(0);

	await clickSlot(page, 0, 18 * 60);
	await expect(quick(page)).toBeVisible();
	await expect(title(page)).toHaveValue("");
});

test("a second drag while the popup is open moves it and keeps the typed fields and focus", async ({
	page,
}) => {
	await page.goto(week);
	await dragRange(page, 1, 9 * 60, 10 * 60);
	await title(page).fill("Keep me");
	await quick(page).getByLabel("Location").fill("Room 9");
	await quick(page).getByLabel("Location").focus();

	await dragRange(page, 6, 14 * 60, 15 * 60);
	await expect(quick(page)).toHaveCount(1);
	await expect(title(page)).toHaveValue("Keep me");
	await expect(quick(page).getByLabel("Location")).toHaveValue("Room 9");
	await expect(quick(page).getByLabel("Start time")).toHaveValue("14:00");
	await expect(block(page)).toHaveCount(1);
	await expect(block(page)).toContainText("Keep me");
	await expect(quick(page).getByLabel("Location")).toBeFocused();
});
