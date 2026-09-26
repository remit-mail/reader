/**
 * Event times across time zones, proved against the server (#1273).
 *
 * Every other calendar spec runs the browser on UTC, where the instant the
 * server stores, the wall time a collection serves and the wall time the device
 * reads are the same digits. Here they are not. Each test pins the browser to a
 * zone with `timezoneId`, reads the stored occurrence back over the API, and
 * then names the exact clock text the week grid, the day grid and the agenda
 * strip have to draw on that device.
 *
 * The rule under test: a calendar draws on the device's clock. The stored
 * instant decides where an event lands, and the offset or collection zone it
 * was written in never leaks into the digits.
 */
import type { Locator, Page } from "@playwright/test";
import type {
	ApiClient,
	CalendarEventInstance,
	CalendarEventResource,
} from "../src/api.js";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };

const written: CalendarEventResource[] = [];
const createdCalendars: string[] = [];

test.afterEach(async ({ api }) => {
	while (written.length > 0) {
		const event = written.pop();
		if (event)
			await api.deleteCalendarEvent(event.calendarObjectId, event.calendarId);
	}
	while (createdCalendars.length > 0) {
		const calendarId = createdCalendars.pop();
		if (calendarId) await api.deleteCalendar(calendarId);
	}
});

const addDays = (date: string, days: number): string => {
	const cursor = new Date(`${date}T00:00:00Z`);
	cursor.setUTCDate(cursor.getUTCDate() + days);
	return cursor.toISOString().slice(0, 10);
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const weekdayOf = (date: string): string =>
	WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";

const escaped = (text: string): string =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A window wide enough to hold the event whichever side of midnight the zones
 * put it, so the read-back never misses an occurrence it should assert on.
 */
const windowAround = (
	first: string,
	last = first,
): { from: string; to: string } => ({
	from: `${addDays(first, -2)}T00:00:00+00:00`,
	to: `${addDays(last, 3)}T00:00:00+00:00`,
});

const defaultCalendarId = async (api: ApiClient): Promise<string> => {
	const calendars = await api.listCalendars();
	const calendarId = calendars[0]?.calendarId ?? "";
	expect(calendarId).not.toBe("");
	return calendarId;
};

const storedOccurrences = async (
	api: ApiClient,
	calendarObjectId: string,
	window: { from: string; to: string },
	count: number,
): Promise<CalendarEventInstance[]> => {
	const items = await waitFor(
		() => api.listCalendarEvents(window.from, window.to),
		(listed) =>
			listed.filter((item) => item.calendarObjectId === calendarObjectId)
				.length === count,
		{ what: `${count} occurrence(s) of the event to be expanded` },
	);
	return items
		.filter((item) => item.calendarObjectId === calendarObjectId)
		.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
};

const utcInstants = (items: CalendarEventInstance[]): string[] =>
	items.map((item) => new Date(item.start).toISOString());

/**
 * The day a grid element sits in, read off the column under its centre. The
 * engine draws an all-day pill in a layer over the cells rather than inside
 * one, so containment would miss it; geometry does not.
 */
const gridDateOf = async (page: Page, element: Locator): Promise<string> => {
	const box = await element.boundingBox();
	if (!box) throw new Error("the event has no box on the grid");
	const centre = box.x + box.width / 2;
	return page
		.locator('[role="gridcell"][data-date]')
		.evaluateAll((cells, x) => {
			const hit = cells.find((cell) => {
				const rect = cell.getBoundingClientRect();
				return rect.left <= x && x < rect.right;
			});
			return hit?.getAttribute("data-date") ?? "";
		}, centre);
};

/**
 * The stretch of the time axis a timed block covers, read off the slot lines
 * its top and bottom edges sit on: "17:00 – 18:00". The chip prints its start
 * only, so its height is the one place the end is drawn.
 */
const gridSpanOf = async (page: Page, element: Locator): Promise<string> => {
	const box = await element.boundingBox();
	if (!box) throw new Error("the event has no box on the grid");
	return page.locator("[data-time]").evaluateAll(
		(slots, edges) => {
			const at = (y: number): string => {
				const slot = slots.find(
					(candidate) =>
						Math.abs(candidate.getBoundingClientRect().top - y) <= 3,
				);
				return (slot?.getAttribute("data-time") ?? "??:??").slice(0, 5);
			};
			return `${at(edges.top)} – ${at(edges.bottom)}`;
		},
		{ top: box.y, bottom: box.y + box.height },
	);
};

const gridEvent = (page: Page, title: string): Locator =>
	page.getByRole("button", { name: title });

const dayHeader = (date: string): RegExp =>
	new RegExp(`^\\s*${Number(date.slice(8))}\\s*${weekdayOf(date)}\\s*$`);

/**
 * The agenda's section for one day. The day is the section's own header — its
 * day number and weekday — so an event filed on the wrong day is not found on
 * the right one.
 */
const agendaDay = (page: Page, date: string): Locator =>
	page
		.getByTestId("agenda-strip")
		.locator("section")
		.filter({
			has: page.locator("header > div").filter({ hasText: dayHeader(date) }),
		});

const agendaChipOn = (page: Page, title: string, date: string): Locator =>
	agendaDay(page, date).getByRole("button", { name: title });

const expectTimedOnScreen = async (
	page: Page,
	title: string,
	date: string,
	start: string,
	end: string,
): Promise<void> => {
	const chipText = new RegExp(`^\\s*${start}\\s*${escaped(title)}\\s*$`);

	await page.goto(`/calendar/week/${date}`);
	const inWeek = gridEvent(page, title);
	await expect(inWeek).toBeVisible({ timeout: 30_000 });
	await expect(inWeek).toHaveText(chipText);
	expect(await gridDateOf(page, inWeek)).toBe(date);
	expect(await gridSpanOf(page, inWeek)).toBe(`${start} – ${end}`);

	await page.goto(`/calendar/day/${date}`);
	const inDay = gridEvent(page, title);
	await expect(inDay).toBeVisible({ timeout: 30_000 });
	await expect(inDay).toHaveText(chipText);
	expect(await gridDateOf(page, inDay)).toBe(date);
	expect(await gridSpanOf(page, inDay)).toBe(`${start} – ${end}`);

	await page.goto(`/calendar/agenda/${date}`);
	const row = agendaChipOn(page, title, date);
	await expect(row).toBeVisible({ timeout: 30_000 });
	await expect(row).toHaveText(
		new RegExp(`^\\s*${start}\\s*${end}\\s*${escaped(title)}`),
	);
};

test.describe("An event written with an explicit offset", () => {
	test.use({ viewport: DESKTOP, timezoneId: "America/Los_Angeles" });

	const TITLE = "Tidewater vendor sync";
	/** 10:00 in Tokyo is 01:00 UTC the next day and 17:00 the evening before in Los Angeles. */
	const START = "2034-02-15T10:00:00+09:00";
	const END = "2034-02-15T11:00:00+09:00";
	const LOCAL_DATE = "2034-02-14";

	test("draws at the device's wall time in the week, the day and the agenda", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);
		const event = await api.createCalendarEvent({
			calendarId: await defaultCalendarId(api),
			summary: TITLE,
			start: START,
			end: END,
		});
		written.push(event);

		const [stored] = await storedOccurrences(
			api,
			event.calendarObjectId,
			windowAround(LOCAL_DATE),
			1,
		);
		expect(Date.parse(stored?.start ?? "")).toBe(Date.parse(START));
		expect(Date.parse(stored?.end ?? "")).toBe(Date.parse(END));
		expect(stored?.allDay).toBe(false);

		await expectTimedOnScreen(page, TITLE, LOCAL_DATE, "17:00", "18:00");
	});
});

test.describe("A calendar zoned away from the device", () => {
	test.use({ viewport: DESKTOP, timezoneId: "America/New_York" });

	const ZONE = "Asia/Tokyo";

	const tokyoCalendar = async (api: ApiClient): Promise<string> => {
		const calendar = await api.createCalendar({
			urlSegment: `tokyo-${Date.now()}`,
			displayName: "Tokyo office",
			timezone: ZONE,
		});
		createdCalendars.push(calendar.calendarId);
		expect(calendar.timezone).toBe(ZONE);
		return calendar.calendarId;
	};

	test("serves the collection's wall time and draws the device's", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);
		const TITLE = "Tidewater Tokyo standup";
		/** 08:00 Wednesday in Tokyo is 18:00 Tuesday in New York. */
		const START = "2034-02-22T08:00:00+09:00";
		const END = "2034-02-22T09:00:00+09:00";
		const LOCAL_DATE = "2034-02-21";

		const event = await api.createCalendarEvent({
			calendarId: await tokyoCalendar(api),
			summary: TITLE,
			start: START,
			end: END,
			timeZone: ZONE,
		});
		written.push(event);

		// The collection's own clock is what the server serves: the same digits
		// the event was written in, on Tokyo's offset.
		const [stored] = await storedOccurrences(
			api,
			event.calendarObjectId,
			windowAround(LOCAL_DATE),
			1,
		);
		expect(stored?.start).toBe(START);
		expect(stored?.end).toBe(END);

		await expectTimedOnScreen(page, TITLE, LOCAL_DATE, "18:00", "19:00");
	});

	/**
	 * A Tokyo afternoon read in New York runs 23:30 to 00:30 the next day.
	 * Opening it and saving it — unchanged, then renamed — has to store the
	 * same instant in the same zone it came with, not the device's offset or the
	 * device's zone.
	 */
	test("saves an event opened across local midnight without moving it", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);
		const TITLE = "Tidewater Tokyo review";
		const RENAMED = "Tidewater Tokyo review, moved room";
		const START = "2034-02-28T13:30:00+09:00";
		const END = "2034-02-28T14:30:00+09:00";
		const LOCAL_DATE = "2034-02-27";

		const calendarId = await tokyoCalendar(api);
		const event = await api.createCalendarEvent({
			calendarId,
			summary: TITLE,
			start: START,
			end: END,
			timeZone: ZONE,
		});
		written.push(event);
		const window = windowAround(LOCAL_DATE);
		await storedOccurrences(api, event.calendarObjectId, window, 1);
		const before = await api.getCalendarEvent(
			event.calendarObjectId,
			calendarId,
		);
		expect(before.icalData).toMatch(/DTSTART;TZID=Asia\/Tokyo:20340228T133000/);

		const edit = async (title: string): Promise<void> => {
			await page.goto(`/calendar/week/${LOCAL_DATE}/${event.calendarObjectId}`);
			const editButton = page.getByRole("button", {
				name: "Edit",
				exact: true,
			});
			await expect(editButton).toBeVisible({ timeout: 30_000 });
			await editButton.click();
			await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
				"23:30",
			);
			await expect(page.getByLabel("End time", { exact: true })).toHaveValue(
				"00:30",
			);
			await expect(page.getByLabel("End date", { exact: true })).toHaveValue(
				"2034-02-28",
			);
			await page.getByRole("textbox", { name: "Title" }).fill(title);
			await page.getByRole("button", { name: "Save", exact: true }).click();
			await expect(page.getByRole("alert")).toHaveCount(0);
			await expect(editButton).toBeVisible({ timeout: 30_000 });
		};

		await edit(TITLE);
		await edit(RENAMED);

		const listed = await waitFor(
			() => api.listCalendarEvents(window.from, window.to),
			(items) => items.some((item) => item.summary === RENAMED),
			{ what: "the renamed event to reach the server" },
		);
		const renamed = listed.find(
			(item) => item.calendarObjectId === event.calendarObjectId,
		);
		expect(renamed?.start).toBe(START);
		expect(renamed?.end).toBe(END);
		const after = await api.getCalendarEvent(
			event.calendarObjectId,
			calendarId,
		);
		expect(after.icalData).toMatch(/DTSTART;TZID=Asia\/Tokyo:20340228T133000/);
		expect(after.icalData).toMatch(/DTEND;TZID=Asia\/Tokyo:20340228T143000/);
	});
});

/**
 * An event stored as the UTC instant 01:00Z on Monday 12 June — Sunday 21:00
 * in New York, Monday 03:00 in Amsterdam — in the default calendar, which is
 * what every event written before device-clock drawing looks like. A repeat
 * added to it from either device has to repeat on the day UTC puts it on, and
 * the event has to stay stored in UTC.
 */
for (const [zone, localDate, choice] of [
	["America/New_York", "2034-06-11", "Every week on Sunday, 21:00"],
	["Europe/Amsterdam", "2034-06-12", "Every week on Monday, 03:00"],
] as const) {
	test.describe(`A repeat added from ${zone} to an event stored in UTC`, () => {
		test.use({ viewport: DESKTOP, timezoneId: zone });

		test("repeats on the UTC day and stays stored in UTC", async ({
			page,
			api,
		}) => {
			test.setTimeout(180_000);
			const TITLE = `Tidewater late call (${zone})`;
			const calendarId = await defaultCalendarId(api);
			const event = await api.createCalendarEvent({
				calendarId,
				summary: TITLE,
				start: "2034-06-12T01:00:00+00:00",
				end: "2034-06-12T02:00:00+00:00",
			});
			written.push(event);
			await storedOccurrences(
				api,
				event.calendarObjectId,
				windowAround("2034-06-12"),
				1,
			);

			await page.goto(`/calendar/week/${localDate}/${event.calendarObjectId}`);
			const edit = page.getByRole("button", { name: "Edit", exact: true });
			await expect(edit).toBeVisible({ timeout: 30_000 });
			await edit.click();
			await page.getByLabel("Repeat").selectOption({ label: choice });
			await page.getByRole("button", { name: "Save", exact: true }).click();
			await expect(page.getByRole("alert")).toHaveCount(0);

			const stored = await storedOccurrences(
				api,
				event.calendarObjectId,
				{ from: "2034-06-10T00:00:00+00:00", to: "2034-06-27T00:00:00+00:00" },
				3,
			);
			expect(utcInstants(stored)).toEqual([
				"2034-06-12T01:00:00.000Z",
				"2034-06-19T01:00:00.000Z",
				"2034-06-26T01:00:00.000Z",
			]);
			const resource = await api.getCalendarEvent(
				event.calendarObjectId,
				calendarId,
			);
			expect(resource.icalData).toMatch(/DTSTART:20340612T010000Z/);
			expect(resource.icalData).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=MO/);
		});
	});
}

test.describe("A slot picked on a device ahead of the calendar", () => {
	test.use({ viewport: DESKTOP, timezoneId: "Europe/Amsterdam" });

	/**
	 * The default calendar names no zone and serves UTC. A drag over 10:00 to
	 * 11:00 on an Amsterdam device is 08:00 UTC in June, and it has to come back
	 * drawn where it was dragged — not two hours later.
	 */
	test("stores the dragged hour and draws it where it was dragged", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);
		const TITLE = "Tidewater dragged slot";
		const DATE = "2034-06-14";

		await page.goto(`/calendar/week/${DATE}`);
		const column = page
			.locator(`[role="gridcell"][data-date="${DATE}"]`)
			.last();
		await expect(column).toBeVisible({ timeout: 30_000 });
		const lane = await column.boundingBox();
		const from = await page
			.locator('[data-time="10:00:00"]')
			.first()
			.boundingBox();
		const to = await page
			.locator('[data-time="10:30:00"]')
			.first()
			.boundingBox();
		if (!lane || !from || !to)
			throw new Error("the time grid has no slots to drag");
		const x = lane.x + lane.width / 2;
		await page.mouse.move(x, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(x, to.y + to.height / 2, { steps: 10 });
		await page.mouse.up();

		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toBeVisible({ timeout: 30_000 });
		await expect(page.getByLabel("Date", { exact: true })).toHaveValue(DATE);
		await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
			"10:00",
		);
		await expect(page.getByLabel("End time", { exact: true })).toHaveValue(
			"11:00",
		);
		await title.fill(TITLE);
		await page.getByRole("button", { name: "Add", exact: true }).click();
		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(title).toHaveCount(0, { timeout: 30_000 });

		const window = windowAround(DATE);
		const listed = await waitFor(
			() => api.listCalendarEvents(window.from, window.to),
			(items) => items.some((item) => item.summary === TITLE),
			{ what: `"${TITLE}" to be expanded` },
		);
		const stored = listed.find((item) => item.summary === TITLE);
		if (!stored) throw new Error(`"${TITLE}" was accepted but never served`);
		written.push({
			calendarObjectId: stored.calendarObjectId,
			calendarId: stored.calendarId,
			icalUid: "",
		});
		expect(new Date(stored.start).toISOString()).toBe(
			"2034-06-14T08:00:00.000Z",
		);
		expect(new Date(stored.end).toISOString()).toBe("2034-06-14T09:00:00.000Z");

		await expectTimedOnScreen(page, TITLE, DATE, "10:00", "11:00");
	});
});

test.describe("A series across a daylight saving change", () => {
	test.describe("seen from the zone it is anchored in", () => {
		test.use({ viewport: DESKTOP, timezoneId: "Europe/Amsterdam" });

		test("meets at 09:00 either side of the spring-forward", async ({
			page,
			api,
		}) => {
			test.setTimeout(300_000);
			const TITLE = "Tidewater Monday planning";
			/** Europe moves its clocks on Sunday 26 March 2034, between the first two. */
			const MONDAYS = ["2034-03-20", "2034-03-27", "2034-04-03"];

			const event = await api.createCalendarEvent({
				calendarId: await defaultCalendarId(api),
				summary: TITLE,
				start: `${MONDAYS[0]}T09:00:00+01:00`,
				end: `${MONDAYS[0]}T10:00:00+01:00`,
				timeZone: "Europe/Amsterdam",
				recurrenceRule: `FREQ=WEEKLY;COUNT=${MONDAYS.length}`,
			});
			written.push(event);

			const stored = await storedOccurrences(
				api,
				event.calendarObjectId,
				windowAround(MONDAYS[0] ?? "", MONDAYS.at(-1)),
				MONDAYS.length,
			);
			expect(utcInstants(stored)).toEqual([
				"2034-03-20T08:00:00.000Z",
				"2034-03-27T07:00:00.000Z",
				"2034-04-03T07:00:00.000Z",
			]);

			for (const monday of MONDAYS)
				await expectTimedOnScreen(page, TITLE, monday, "09:00", "10:00");
		});

		test("meets at 09:00 either side of the fall-back", async ({
			page,
			api,
		}) => {
			test.setTimeout(300_000);
			const TITLE = "Tidewater autumn planning";
			/** Europe moves its clocks back on Sunday 29 October 2034. */
			const MONDAYS = ["2034-10-23", "2034-10-30", "2034-11-06"];

			const event = await api.createCalendarEvent({
				calendarId: await defaultCalendarId(api),
				summary: TITLE,
				start: `${MONDAYS[0]}T09:00:00+02:00`,
				end: `${MONDAYS[0]}T10:00:00+02:00`,
				timeZone: "Europe/Amsterdam",
				recurrenceRule: `FREQ=WEEKLY;COUNT=${MONDAYS.length}`,
			});
			written.push(event);

			const stored = await storedOccurrences(
				api,
				event.calendarObjectId,
				windowAround(MONDAYS[0] ?? "", MONDAYS.at(-1)),
				MONDAYS.length,
			);
			expect(utcInstants(stored)).toEqual([
				"2034-10-23T07:00:00.000Z",
				"2034-10-30T08:00:00.000Z",
				"2034-11-06T08:00:00.000Z",
			]);

			for (const monday of MONDAYS)
				await expectTimedOnScreen(page, TITLE, monday, "09:00", "10:00");
		});
	});

	test.describe("seen from a zone that changes on another day", () => {
		test.use({ viewport: DESKTOP, timezoneId: "America/New_York" });

		/**
		 * New York moves on 12 March 2034 and Amsterdam on 26 March, so an
		 * Amsterdam 15:00 is 09:00 in New York, then 10:00 for the two weeks in
		 * between, then 09:00 again.
		 */
		test("follows the anchor's clock, not the device's", async ({
			page,
			api,
		}) => {
			test.setTimeout(360_000);
			const TITLE = "Tidewater Amsterdam sync";
			const MONDAYS = ["2034-03-06", "2034-03-13", "2034-03-20", "2034-03-27"];
			const SHOWN = [
				["09:00", "10:00"],
				["10:00", "11:00"],
				["10:00", "11:00"],
				["09:00", "10:00"],
			];

			const event = await api.createCalendarEvent({
				calendarId: await defaultCalendarId(api),
				summary: TITLE,
				start: `${MONDAYS[0]}T15:00:00+01:00`,
				end: `${MONDAYS[0]}T16:00:00+01:00`,
				timeZone: "Europe/Amsterdam",
				recurrenceRule: `FREQ=WEEKLY;COUNT=${MONDAYS.length}`,
			});
			written.push(event);

			const stored = await storedOccurrences(
				api,
				event.calendarObjectId,
				windowAround(MONDAYS[0] ?? "", MONDAYS.at(-1)),
				MONDAYS.length,
			);
			expect(utcInstants(stored)).toEqual([
				"2034-03-06T14:00:00.000Z",
				"2034-03-13T14:00:00.000Z",
				"2034-03-20T14:00:00.000Z",
				"2034-03-27T13:00:00.000Z",
			]);

			for (const [index, monday] of MONDAYS.entries()) {
				const [start, end] = SHOWN[index] ?? [];
				await expectTimedOnScreen(page, TITLE, monday, start ?? "", end ?? "");
			}
		});

		/**
		 * The default calendar names no zone. A weekly 09:00 written into it from
		 * New York is anchored in New York, so it is still 09:00 after the
		 * clocks change — stored in UTC it would meet at 10:00.
		 */
		test("keeps a series written into the default calendar on the writer's clock", async ({
			page,
			api,
		}) => {
			test.setTimeout(300_000);
			const TITLE = "Tidewater weekly from New York";
			const MONDAYS = ["2034-03-06", "2034-03-13", "2034-03-20"];

			await page.goto(`/calendar/week/${MONDAYS[0]}/new`);
			const title = page.getByRole("textbox", { name: "Title" });
			await expect(title).toBeVisible({ timeout: 30_000 });
			await title.fill(TITLE);
			await expect(page.getByLabel("Date", { exact: true })).toHaveValue(
				MONDAYS[0] ?? "",
			);
			await page.getByLabel("Start time", { exact: true }).fill("09:00");
			await page.getByLabel("End time", { exact: true }).fill("10:00");
			await page
				.getByLabel("Repeat")
				.selectOption({ label: "Every week on Monday, 09:00" });
			await page.getByRole("button", { name: "Add", exact: true }).click();
			await expect(page.getByRole("alert")).toHaveCount(0);

			const window = windowAround(MONDAYS[0] ?? "", MONDAYS.at(-1));
			const listed = await waitFor(
				() => api.listCalendarEvents(window.from, window.to),
				(items) => items.some((item) => item.summary === TITLE),
				{ what: `"${TITLE}" to be expanded` },
			);
			const first = listed.find((item) => item.summary === TITLE);
			if (!first) throw new Error(`"${TITLE}" was accepted but never served`);
			written.push({
				calendarObjectId: first.calendarObjectId,
				calendarId: first.calendarId,
				icalUid: "",
			});

			const stored = await storedOccurrences(
				api,
				first.calendarObjectId,
				{
					from: `${MONDAYS[0]}T00:00:00-05:00`,
					to: `${addDays(MONDAYS.at(-1) ?? "", 1)}T00:00:00-04:00`,
				},
				MONDAYS.length,
			);
			expect(utcInstants(stored)).toEqual([
				"2034-03-06T14:00:00.000Z",
				"2034-03-13T13:00:00.000Z",
				"2034-03-20T13:00:00.000Z",
			]);
			const resource = await api.getCalendarEvent(
				first.calendarObjectId,
				first.calendarId,
			);
			expect(resource.icalData).toMatch(/DTSTART;TZID=America\/New_York:/);
			expect(resource.icalData).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=MO/);

			for (const monday of MONDAYS)
				await expectTimedOnScreen(page, TITLE, monday, "09:00", "10:00");
		});
	});
});

for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
	test.describe(`An all-day event seen from ${zone}`, () => {
		test.use({ viewport: DESKTOP, timezoneId: zone });

		const TITLE = `Tidewater audit day (${zone})`;
		const DATE = "2034-03-01";

		test("stays on its own day", async ({ page, api }) => {
			test.setTimeout(180_000);
			const event = await api.createCalendarEvent({
				calendarId: await defaultCalendarId(api),
				summary: TITLE,
				start: DATE,
				end: addDays(DATE, 1),
				allDay: true,
			});
			written.push(event);

			const [stored] = await storedOccurrences(
				api,
				event.calendarObjectId,
				windowAround(DATE),
				1,
			);
			expect(stored?.allDay).toBe(true);
			expect(stored?.start.slice(0, 10)).toBe(DATE);
			expect(stored?.end.slice(0, 10)).toBe(addDays(DATE, 1));

			await page.goto(`/calendar/week/${DATE}`);
			const inWeek = gridEvent(page, TITLE);
			await expect(inWeek).toBeVisible({ timeout: 30_000 });
			expect(await gridDateOf(page, inWeek)).toBe(DATE);

			await page.goto(`/calendar/day/${DATE}`);
			await expect(gridEvent(page, TITLE)).toBeVisible({ timeout: 30_000 });

			await page.goto(`/calendar/agenda/${DATE}`);
			const row = agendaChipOn(page, TITLE, DATE);
			await expect(row).toBeVisible({ timeout: 30_000 });
			await expect(agendaDay(page, DATE)).toContainText("All day");
		});
	});
}
