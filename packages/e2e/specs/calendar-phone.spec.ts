/**
 * The calendar on a phone: a held finger drops an hour on the day view, a drag
 * stretches it, and a held event moves where the finger takes it.
 */
import { devices, type Page } from "@playwright/test";
import { waitFor } from "../src/api.js";
import {
	amsterdam,
	CALENDAR_ZONE,
	calendarIdOf,
	deleteEventsByPrefix,
	weekDay,
} from "../src/calendar.js";
import { holdAndDrag, slotPoint } from "../src/calendar-grid.js";
import { expect, test } from "../src/fixtures.js";

const PHONE = devices["Pixel 7"];
test.use({
	viewport: PHONE.viewport,
	userAgent: PHONE.userAgent,
	deviceScaleFactor: PHONE.deviceScaleFactor,
	isMobile: true,
	hasTouch: true,
	timezoneId: CALENDAR_ZONE,
	locale: "en-GB",
});

const PREFIX = "e2e phone";
const HELD = `${PREFIX} held`;
const day = `/calendar/week/${weekDay(2)}`;
const sheet = (page: Page) => page.getByRole("dialog", { name: "New event" });
const block = (page: Page) => page.locator("[data-draft-block]");

const cleanUp = () => deleteEventsByPrefix(PREFIX);
test.afterAll(cleanUp);

test("a hold drops a block, a drag stretches it, and release opens the sheet below it", async ({
	page,
}) => {
	await page.goto(day);
	const from = await slotPoint(page, 0, 10 * 60, 1);
	await holdAndDrag(page, from, { x: from.x, y: from.y + 48 }, 650);
	await expect(sheet(page)).toBeVisible();
	await expect(sheet(page).getByLabel("Start time")).toHaveValue("10:00");
	await expect(sheet(page).getByLabel("End time")).toHaveValue("12:00");
	const range = await block(page).boundingBox();
	const card = await sheet(page).boundingBox();
	expect((range?.y ?? 0) + (range?.height ?? 0)).toBeLessThanOrEqual(
		card?.y ?? 0,
	);
});

test("a hold on an event lifts it, and a drag moves it", async ({
	page,
	api,
}) => {
	await api.createCalendarEvent({
		calendarId: await calendarIdOf(api, "work"),
		summary: HELD,
		start: amsterdam(weekDay(2), "06:00"),
		end: amsterdam(weekDay(2), "07:00"),
		timeZone: CALENDAR_ZONE,
	});
	await page.goto(day);
	await slotPoint(page, 0, 6 * 60, 1);
	const chip = page.locator("[data-event-id]", { hasText: HELD });
	const box = await chip.boundingBox();
	if (!box) throw new Error(`no chip ${HELD}`);
	const from = { x: box.x + box.width / 2, y: box.y + 8 };
	await holdAndDrag(page, from, { x: from.x, y: from.y + 96 }, 650);

	const moved = amsterdam(weekDay(2), "08:00");
	await waitFor(
		() =>
			api.listCalendarEvents(
				amsterdam(weekDay(2), "00:00"),
				amsterdam(weekDay(3), "00:00"),
			),
		(items) =>
			items.some(
				(item) =>
					item.summary === HELD &&
					new Date(item.start).getTime() === new Date(moved).getTime(),
			),
		{ what: `"${HELD}" stored at 08:00` },
	);
});
