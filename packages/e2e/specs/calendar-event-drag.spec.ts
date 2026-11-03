/**
 * Moving and resizing a saved event by dragging it on the week grid. The new
 * times are read back from the API, which is what the drag had to change.
 */
import type { Page } from "@playwright/test";
import { type ApiClient, waitFor } from "../src/api.js";
import {
	amsterdam,
	CALENDAR_ZONE,
	calendarIdOf,
	deleteEventsByPrefix,
	weekDay,
} from "../src/calendar.js";
import { drag, slotPoint } from "../src/calendar-grid.js";
import { expect, test } from "../src/fixtures.js";

test.use({
	viewport: { width: 1440, height: 900 },
	timezoneId: CALENDAR_ZONE,
	locale: "en-GB",
});

const PREFIX = "e2e drag";
const MEETING = `${PREFIX} meeting`;
const week = `/calendar/week/${weekDay(0)}`;
const chip = (page: Page) =>
	page.locator("[data-event-id]", { hasText: MEETING }).first();

const cleanUp = () => deleteEventsByPrefix(PREFIX);
test.beforeEach(async ({ api }) => {
	await cleanUp();
	await api.createCalendarEvent({
		calendarId: await calendarIdOf(api, "work"),
		summary: MEETING,
		start: amsterdam(weekDay(1), "06:00"),
		end: amsterdam(weekDay(1), "07:00"),
		timeZone: CALENDAR_ZONE,
	});
});
test.afterAll(cleanUp);

const storedAs = async (
	api: ApiClient,
	start: string,
	end: string,
): Promise<void> => {
	await waitFor(
		() =>
			api.listCalendarEvents(
				amsterdam(weekDay(0), "00:00"),
				amsterdam(weekDay(7), "00:00"),
			),
		(items) =>
			items.some(
				(item) =>
					item.summary === MEETING &&
					new Date(item.start).getTime() === new Date(start).getTime() &&
					new Date(item.end).getTime() === new Date(end).getTime(),
			),
		{ what: `"${MEETING}" stored from ${start} to ${end}` },
	);
};

test("a dragged event moves to another day and time and is saved there", async ({
	page,
	api,
}) => {
	await page.goto(week);
	const target = await slotPoint(page, 3, 6 * 60);
	const box = await chip(page).boundingBox();
	if (!box) throw new Error(`no chip ${MEETING}`);
	const from = { x: box.x + box.width / 2, y: box.y + 6 };
	await drag(page, from, { x: target.x, y: from.y + 96 });
	await expect(page.locator("[aria-live='polite']").first()).toContainText(
		/Thursday .*08:00 to 09:00/,
	);
	await expect(page).toHaveURL(new RegExp(`${week}$`));
	await storedAs(
		api,
		amsterdam(weekDay(3), "08:00"),
		amsterdam(weekDay(3), "09:00"),
	);
});

test("the bottom edge resizes the event in quarter hours", async ({
	page,
	api,
}) => {
	await page.goto(week);
	await slotPoint(page, 1, 6 * 60);
	const handle = chip(page).locator(
		"xpath=following-sibling::*[@data-resize-handle]",
	);
	const box = await handle.boundingBox();
	if (!box) throw new Error("no resize handle");
	const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await drag(page, from, { x: from.x, y: from.y + 36 });
	await expect(page.locator("[aria-live='polite']").first()).toContainText(
		"06:00 to 07:45",
	);
	await storedAs(
		api,
		amsterdam(weekDay(1), "06:00"),
		amsterdam(weekDay(1), "07:45"),
	);
});
