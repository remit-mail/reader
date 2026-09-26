/**
 * The whole-series scope and the repeat rules the form offers, proved against
 * the server (#1274).
 *
 * A rule is only as good as the occurrences the deployment expands it into, so
 * every claim about which days a series lands on is `GET /calendar-events` —
 * what the next client that asks is served — and the grid is then held to the
 * same days.
 */
import type { Page } from "@playwright/test";
import type { CalendarEventInstance } from "../src/api.js";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };
test.use({ viewport: DESKTOP, timezoneId: "UTC" });

const addDays = (date: string, days: number): string => {
	const cursor = new Date(`${date}T00:00:00Z`);
	cursor.setUTCDate(cursor.getUTCDate() + days);
	return cursor.toISOString().slice(0, 10);
};

const window = (from: string, to: string) => ({
	from: `${from}T00:00:00+00:00`,
	to: `${to}T00:00:00+00:00`,
});

const weekPath = (date: string): string => `/calendar/week/${date}`;

const weekUrl = (date: string): RegExp =>
	new RegExp(`${weekPath(date)}(\\?|#|$)`);

const startDays = (items: CalendarEventInstance[]): string[] =>
	items.map((item) => item.start.slice(0, 10));

const titled = (items: CalendarEventInstance[], summary: string) =>
	items.filter((item) => item.summary === summary);

/**
 * Every object a test wrote, however it was written, so the next spec on the
 * shared account never meets it.
 */
const written = new Map<string, string>();

test.afterEach(async ({ api }) => {
	for (const [calendarObjectId, calendarId] of written) {
		await api.deleteCalendarEvent(calendarObjectId, calendarId);
	}
	written.clear();
});

const remember = (items: CalendarEventInstance[]): void => {
	for (const item of items) written.set(item.calendarObjectId, item.calendarId);
};

const columnName = (date: string): string =>
	new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});

/**
 * Which day each timed occurrence is drawn under. The week's column headers
 * name their dates, and the timed row holds one cell per column in the same
 * order.
 */
const expectDrawnOn = async (
	page: Page,
	summary: string,
	weekOf: string,
	days: string[],
): Promise<void> => {
	await page.goto(weekPath(weekOf));
	const headers = page.getByRole("columnheader");
	const timed = page.getByRole("row", { name: /^Timed/ }).first();
	const cells = timed.getByRole("gridcell");
	await expect(headers).toHaveCount(7, { timeout: 30_000 });
	await expect(timed.getByRole("button", { name: summary })).toHaveCount(
		days.length,
		{ timeout: 30_000 },
	);
	await expect(cells).toHaveCount(7);
	for (let offset = 0; offset < 7; offset += 1) {
		const day = addDays(weekOf, offset);
		await expect(headers.nth(offset)).toHaveAccessibleName(columnName(day));
		await expect(
			cells.nth(offset).getByRole("button", { name: summary }),
		).toHaveCount(days.includes(day) ? 1 : 0);
	}
};

/** Writes an event through the composer with one of the offered rules. */
const composeRepeating = async (
	page: Page,
	date: string,
	summary: string,
	rule: string,
): Promise<void> => {
	await page.goto(`${weekPath(date)}/new`);

	const title = page.getByRole("textbox", { name: "Title" });
	await expect(title).toBeVisible({ timeout: 30_000 });
	await title.fill(summary);
	await expect(page.getByLabel("Date", { exact: true })).toHaveValue(date);
	await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
		"09:00",
	);

	await page
		.getByRole("combobox", { name: "Repeat" })
		.selectOption({ label: `${rule}, 09:00` });
	await page.getByRole("button", { name: "Add", exact: true }).click();

	await expect(page.getByRole("alert")).toHaveCount(0);
	await expect(page).toHaveURL(weekUrl(date), { timeout: 30_000 });
};

test.describe("The whole series", () => {
	const START = "2031-06-02";
	const OCCURRENCES = 5;
	const SERIES = "Fabrikam weekly review";
	const RENAMED = "Fabrikam weekly review, new room";
	const MONDAYS = [0, 1, 2, 3, 4].map((week) => addDays(START, week * 7));
	const WINDOW = window(START, addDays(START, 7 * (OCCURRENCES + 2)));

	test("an edit reaches every occurrence and a delete removes them all", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);

		const calendars = await api.listCalendars();
		const calendarId = calendars[0]?.calendarId ?? "";
		expect(calendarId).not.toBe("");
		const series = await api.createCalendarEvent({
			calendarId,
			summary: SERIES,
			start: `${START}T10:00:00+00:00`,
			end: `${START}T11:00:00+00:00`,
			recurrenceRule: `FREQ=WEEKLY;COUNT=${OCCURRENCES}`,
		});
		written.set(series.calendarObjectId, series.calendarId);

		const ofSeries = (items: CalendarEventInstance[]) =>
			items.filter((item) => item.calendarObjectId === series.calendarObjectId);

		await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => ofSeries(items).length === OCCURRENCES,
			{ what: "the weekly series to be expanded into the window" },
		);

		// Opened from its second Monday, so an edit that anchors the rule at the
		// occurrence it was opened from rather than at the series loses the first.
		await page.goto(weekPath(MONDAYS[1]));
		await page.getByRole("button", { name: SERIES }).click();
		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();
		await page.getByRole("button", { name: "The whole series" }).click();

		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toHaveValue(SERIES);
		await title.fill(RENAMED);
		await page.getByLabel("Start time", { exact: true }).fill("14:00");
		await page.getByLabel("End time", { exact: true }).fill("15:30");
		await page.getByRole("button", { name: "Save", exact: true }).click();

		await expect(title).toHaveCount(0, { timeout: 30_000 });
		await expect(page.getByRole("alert")).toHaveCount(0);

		const edited = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => titled(ofSeries(items), RENAMED).length > 0,
			{ what: "the whole-series edit to reach the server" },
		);
		const occurrences = ofSeries(edited);
		expect(startDays(occurrences)).toEqual(MONDAYS);
		expect(occurrences.map((item) => item.summary)).toEqual(
			MONDAYS.map(() => RENAMED),
		);
		expect(occurrences.map((item) => item.start.slice(11, 16))).toEqual(
			MONDAYS.map(() => "14:00"),
		);
		expect(occurrences.map((item) => item.end.slice(11, 16))).toEqual(
			MONDAYS.map(() => "15:30"),
		);

		await page.goto(weekPath(MONDAYS[2]));
		await page.getByRole("button", { name: RENAMED }).click();
		const remove = page.getByRole("button", { name: "Delete", exact: true });
		await expect(remove).toBeVisible({ timeout: 30_000 });
		await remove.click();
		await page.getByRole("button", { name: "The whole series" }).click();
		await expect(page).toHaveURL(weekUrl(MONDAYS[2]), { timeout: 30_000 });

		await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => ofSeries(items).length === 0,
			{ what: "every occurrence of the series to be gone from the server" },
		);
		await expect(page.getByRole("button", { name: RENAMED })).toHaveCount(0);
	});

	test("an edit made from an occurrence moved on its own keeps the series on its weekday", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);
		const MOVED_SERIES = "Fabrikam design crit";
		const FIRST = "2031-08-04";
		const weeks = [0, 1, 2, 3, 4].map((week) => addDays(FIRST, week * 7));
		const MOVED_TO = addDays(weeks[1], 2);
		const RANGE = window(FIRST, addDays(FIRST, 7 * (OCCURRENCES + 2)));

		const calendars = await api.listCalendars();
		const calendarId = calendars[0]?.calendarId ?? "";
		expect(calendarId).not.toBe("");
		const series = await api.createCalendarEvent({
			calendarId,
			summary: MOVED_SERIES,
			start: `${FIRST}T09:00:00+00:00`,
			end: `${FIRST}T10:00:00+00:00`,
			recurrenceRule: `FREQ=WEEKLY;COUNT=${OCCURRENCES}`,
		});
		written.set(series.calendarObjectId, series.calendarId);

		const ofSeries = (items: CalendarEventInstance[]) =>
			items.filter((item) => item.calendarObjectId === series.calendarObjectId);

		const expanded = await waitFor(
			() => api.listCalendarEvents(RANGE.from, RANGE.to),
			(items) => ofSeries(items).length === OCCURRENCES,
			{ what: "the weekly series to be expanded into the window" },
		);
		const second = ofSeries(expanded)[1];
		if (!second) throw new Error("the series has no second occurrence");

		// The second Monday moves to the Wednesday on its own, the way a "This
		// event" edit leaves it.
		await api.updateCalendarEvent(
			series.calendarObjectId,
			series.calendarId,
			{
				start: `${MOVED_TO}T09:00:00+00:00`,
				end: `${MOVED_TO}T10:00:00+00:00`,
			},
			{ scope: "This", recurrenceId: second.recurrenceId },
		);
		await waitFor(
			() => api.listCalendarEvents(RANGE.from, RANGE.to),
			(items) => startDays(ofSeries(items)).includes(MOVED_TO),
			{ what: "the second occurrence to be moved to the Wednesday" },
		);

		await page.goto(weekPath(weeks[1]));
		await page.getByRole("button", { name: MOVED_SERIES }).click();
		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();
		await page.getByRole("button", { name: "The whole series" }).click();

		const startTime = page.getByLabel("Start time", { exact: true });
		await expect(startTime).toHaveValue("09:00");
		await startTime.fill("10:00");
		await page.getByLabel("End time", { exact: true }).fill("11:00");
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(startTime).toHaveCount(0, { timeout: 30_000 });
		await expect(page.getByRole("alert")).toHaveCount(0);

		const edited = await waitFor(
			() => api.listCalendarEvents(RANGE.from, RANGE.to),
			(items) =>
				ofSeries(items).some((item) => item.start.slice(11, 16) === "10:00"),
			{ what: "the whole-series edit to reach the server" },
		);
		const occurrences = ofSeries(edited);
		expect(startDays(occurrences)).toEqual([
			weeks[0],
			MOVED_TO,
			weeks[2],
			weeks[3],
			weeks[4],
		]);
		expect(
			occurrences
				.filter((item) => item.start.slice(0, 10) !== MOVED_TO)
				.map((item) => item.start.slice(11, 16)),
		).toEqual(["10:00", "10:00", "10:00", "10:00"]);
	});
});

test.describe("A whole-series edit that moves the series", () => {
	const OCCURRENCES = 4;

	test("a Monday series moved to Tuesday repeats on Tuesdays", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);
		const SERIES = "Fabrikam supplier call";
		const FIRST = "2031-09-01";
		const mondays = [0, 1, 2, 3].map((week) => addDays(FIRST, week * 7));
		const tuesdays = mondays.map((monday) => addDays(monday, 1));
		const RANGE = window(FIRST, addDays(FIRST, 7 * (OCCURRENCES + 2)));

		const calendars = await api.listCalendars();
		const calendarId = calendars[0]?.calendarId ?? "";
		expect(calendarId).not.toBe("");
		const series = await api.createCalendarEvent({
			calendarId,
			summary: SERIES,
			start: `${FIRST}T09:00:00+00:00`,
			end: `${FIRST}T10:00:00+00:00`,
			recurrenceRule: `FREQ=WEEKLY;BYDAY=MO;COUNT=${OCCURRENCES}`,
		});
		written.set(series.calendarObjectId, series.calendarId);

		const ofSeries = (items: CalendarEventInstance[]) =>
			items.filter((item) => item.calendarObjectId === series.calendarObjectId);

		const expanded = await waitFor(
			() => api.listCalendarEvents(RANGE.from, RANGE.to),
			(items) => ofSeries(items).length === OCCURRENCES,
			{ what: "the Monday series to be expanded into the window" },
		);
		expect(startDays(ofSeries(expanded))).toEqual(mondays);

		await page.goto(weekPath(mondays[1] ?? FIRST));
		await page.getByRole("button", { name: SERIES }).click();
		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();
		await page.getByRole("button", { name: "The whole series" }).click();

		const date = page.getByLabel("Date", { exact: true });
		await expect(date).toHaveValue(mondays[1] ?? "");
		await date.fill(tuesdays[1] ?? "");
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(date).toHaveCount(0, { timeout: 30_000 });
		await expect(page.getByRole("alert")).toHaveCount(0);

		const moved = await waitFor(
			() => api.listCalendarEvents(RANGE.from, RANGE.to),
			(items) => startDays(ofSeries(items))[0] === tuesdays[0],
			{ what: "the whole-series move to reach the server" },
		);
		const occurrences = ofSeries(moved);
		expect(startDays(occurrences)).toEqual(tuesdays);
		expect(occurrences.map((item) => item.start.slice(11, 16))).toEqual(
			tuesdays.map(() => "09:00"),
		);
	});

	test("a deleted and a single-edited occurrence survive a series time change", async ({
		api,
	}) => {
		test.setTimeout(120_000);
		const SERIES = "Fabrikam ops sync";
		const FIRST = "2031-10-06";
		const weeks = [0, 1, 2, 3, 4].map((week) => addDays(FIRST, week * 7));
		const RANGE = window(FIRST, addDays(FIRST, 7 * 7));

		const calendars = await api.listCalendars();
		const calendarId = calendars[0]?.calendarId ?? "";
		expect(calendarId).not.toBe("");
		const series = await api.createCalendarEvent({
			calendarId,
			summary: SERIES,
			start: `${FIRST}T09:00:00+00:00`,
			end: `${FIRST}T10:00:00+00:00`,
			recurrenceRule: `FREQ=WEEKLY;COUNT=${weeks.length}`,
		});
		written.set(series.calendarObjectId, series.calendarId);

		const ofSeries = (items: CalendarEventInstance[]) =>
			items.filter((item) => item.calendarObjectId === series.calendarObjectId);
		const occurrenceOn = (items: CalendarEventInstance[], day: string) => {
			const found = ofSeries(items).find(
				(item) => item.start.slice(0, 10) === day,
			);
			if (!found) throw new Error(`the series has no occurrence on ${day}`);
			return found;
		};

		const expanded = await waitFor(
			() => api.listCalendarEvents(RANGE.from, RANGE.to),
			(items) => ofSeries(items).length === weeks.length,
			{ what: "the weekly series to be expanded into the window" },
		);

		const removed = await api.deleteCalendarEvent(
			series.calendarObjectId,
			series.calendarId,
			{
				scope: "This",
				recurrenceId: occurrenceOn(expanded, weeks[1] ?? "").recurrenceId,
			},
		);
		expect(removed.ok).toBe(true);
		await api.updateCalendarEvent(
			series.calendarObjectId,
			series.calendarId,
			{
				start: `${weeks[2]}T13:00:00+00:00`,
				end: `${weeks[2]}T14:00:00+00:00`,
			},
			{
				scope: "This",
				recurrenceId: occurrenceOn(expanded, weeks[2] ?? "").recurrenceId,
			},
		);
		const excepted = await waitFor(
			() => api.listCalendarEvents(RANGE.from, RANGE.to),
			(items) =>
				ofSeries(items).length === weeks.length - 1 &&
				ofSeries(items).some((item) => item.start.slice(11, 16) === "13:00"),
			{ what: "the deleted and the single-edited occurrence to be written" },
		);

		await api.updateCalendarEvent(
			series.calendarObjectId,
			series.calendarId,
			{
				start: `${weeks[3]}T10:00:00+00:00`,
				end: `${weeks[3]}T11:00:00+00:00`,
			},
			{
				scope: "All",
				recurrenceId: occurrenceOn(excepted, weeks[3] ?? "").recurrenceId,
			},
		);

		const edited = await waitFor(
			() => api.listCalendarEvents(RANGE.from, RANGE.to),
			(items) =>
				ofSeries(items).some((item) => item.start.slice(11, 16) === "10:00"),
			{ what: "the whole-series time change to reach the server" },
		);
		expect(ofSeries(edited).map((item) => item.start.slice(0, 16))).toEqual([
			`${weeks[0]}T10:00`,
			`${weeks[2]}T13:00`,
			`${weeks[3]}T10:00`,
			`${weeks[4]}T10:00`,
		]);
	});
});

test.describe("Repeat rules picked in the form", () => {
	test("every weekday lands on Monday to Friday only", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);
		const SUMMARY = "Contoso standup";
		const WEDNESDAY = "2031-07-02";
		const WINDOW = window("2031-06-30", "2031-07-14");

		await composeRepeating(page, WEDNESDAY, SUMMARY, "Every weekday");

		const expanded = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => titled(items, SUMMARY).length > 0,
			{ what: `"${SUMMARY}" to be expanded into the window` },
		);
		const occurrences = titled(expanded, SUMMARY);
		remember(occurrences);
		expect(startDays(occurrences)).toEqual([
			"2031-07-02",
			"2031-07-03",
			"2031-07-04",
			"2031-07-07",
			"2031-07-08",
			"2031-07-09",
			"2031-07-10",
			"2031-07-11",
		]);
		expect(
			occurrences.every((item) => item.start.slice(11, 16) === "09:00"),
		).toBe(true);

		await expectDrawnOn(page, SUMMARY, "2031-07-07", [
			"2031-07-07",
			"2031-07-08",
			"2031-07-09",
			"2031-07-10",
			"2031-07-11",
		]);
	});

	test("every month on the second Wednesday", async ({ page, api }) => {
		test.setTimeout(180_000);
		const SUMMARY = "Contoso board pack";
		const WINDOW = window("2031-07-01", "2032-01-01");

		await composeRepeating(
			page,
			"2031-07-09",
			SUMMARY,
			"Every month on the second Wednesday",
		);

		const expanded = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => titled(items, SUMMARY).length > 0,
			{ what: `"${SUMMARY}" to be expanded into the window` },
		);
		const occurrences = titled(expanded, SUMMARY);
		remember(occurrences);
		expect(startDays(occurrences)).toEqual([
			"2031-07-09",
			"2031-08-13",
			"2031-09-10",
			"2031-10-08",
			"2031-11-12",
			"2031-12-10",
		]);

		await expectDrawnOn(page, SUMMARY, "2031-08-11", ["2031-08-13"]);
	});

	test("every month on the last Wednesday", async ({ page, api }) => {
		test.setTimeout(180_000);
		const SUMMARY = "Contoso month close";
		const WINDOW = window("2031-07-01", "2032-01-01");

		await composeRepeating(
			page,
			"2031-07-30",
			SUMMARY,
			"Every month on the last Wednesday",
		);

		const expanded = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => titled(items, SUMMARY).length > 0,
			{ what: `"${SUMMARY}" to be expanded into the window` },
		);
		const occurrences = titled(expanded, SUMMARY);
		remember(occurrences);
		expect(startDays(occurrences)).toEqual([
			"2031-07-30",
			"2031-08-27",
			"2031-09-24",
			"2031-10-29",
			"2031-11-26",
			"2031-12-31",
		]);

		await expectDrawnOn(page, SUMMARY, "2031-10-27", ["2031-10-29"]);
	});

	test("every year on the same day", async ({ page, api }) => {
		test.setTimeout(180_000);
		const SUMMARY = "Contoso anniversary";
		const YEARS = [2031, 2032, 2033];

		await composeRepeating(
			page,
			"2031-07-15",
			SUMMARY,
			"Every year on 15 July",
		);

		// A read may cover a year at most, so each year is asked for on its own.
		const occurrences: CalendarEventInstance[] = [];
		for (const year of YEARS) {
			const WINDOW = window(`${year}-01-01`, `${year}-12-31`);
			const expanded = await waitFor(
				() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
				(items) => titled(items, SUMMARY).length > 0,
				{ what: `"${SUMMARY}" to be expanded into ${year}` },
			);
			occurrences.push(...titled(expanded, SUMMARY));
		}
		remember(occurrences);
		expect(startDays(occurrences)).toEqual([
			"2031-07-15",
			"2032-07-15",
			"2033-07-15",
		]);

		await expectDrawnOn(page, SUMMARY, "2032-07-12", ["2032-07-15"]);
	});
});

test.describe("A one-off event given a repeat", () => {
	test("opens from its plain address at an occurrence, with Edit (#1332)", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);
		const SUMMARY = "Fabrikam retro";
		const FIRST = "2031-11-03";
		const MONDAYS = [0, 1, 2].map((week) => addDays(FIRST, week * 7));
		const RANGE = window(FIRST, addDays(FIRST, 15));

		const calendars = await api.listCalendars();
		const calendarId = calendars[0]?.calendarId ?? "";
		expect(calendarId).not.toBe("");
		const event = await api.createCalendarEvent({
			calendarId,
			summary: SUMMARY,
			start: `${FIRST}T09:00:00+00:00`,
			end: `${FIRST}T10:00:00+00:00`,
		});
		written.set(event.calendarObjectId, event.calendarId);

		const ofEvent = (items: CalendarEventInstance[]) =>
			items.filter((item) => item.calendarObjectId === event.calendarObjectId);
		await waitFor(
			() => api.listCalendarEvents(RANGE.from, RANGE.to),
			(items) => ofEvent(items).length === 1,
			{ what: "the one-off event to be listed" },
		);

		const plainPath = `${weekPath(FIRST)}/${event.calendarObjectId}`;
		await page.goto(plainPath);
		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();
		await page
			.getByRole("combobox", { name: "Repeat" })
			.selectOption({ label: "Every week on Monday, 09:00" });
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(page.getByRole("alert")).toHaveCount(0);

		const repeating = await waitFor(
			() => api.listCalendarEvents(RANGE.from, RANGE.to),
			(items) => ofEvent(items).length === MONDAYS.length,
			{ what: "the repeat to reach the server" },
		);
		const occurrences = ofEvent(repeating);
		expect(startDays(occurrences)).toEqual(MONDAYS);
		expect(occurrences.every((item) => item.recurrenceId !== "")).toBe(true);
		const resource = await api.getCalendarEvent(
			event.calendarObjectId,
			calendarId,
		);
		expect(resource.icalData).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=MO/);

		await page.goto(plainPath);
		await expect(page).toHaveURL(
			new RegExp(
				`${plainPath}/${encodeURIComponent(occurrences[0]?.recurrenceId ?? "")}(\\?|#|$)`,
			),
			{ timeout: 30_000 },
		);
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();
		await expect(
			page.getByRole("button", { name: "This event" }),
		).toBeVisible();
		await page.getByRole("button", { name: "The whole series" }).click();
		await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
			SUMMARY,
		);
	});

	test("moves a month without an occurrence to the day of the first one (#1332)", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);
		const SUMMARY = "Fabrikam planning";
		const FIRST = "2032-02-02";
		const EMPTY_MONTH = "2032-05-10";
		const RANGE = window(FIRST, addDays(FIRST, 21));

		const calendars = await api.listCalendars();
		const calendarId = calendars[0]?.calendarId ?? "";
		expect(calendarId).not.toBe("");
		const series = await api.createCalendarEvent({
			calendarId,
			summary: SUMMARY,
			start: `${FIRST}T09:00:00+00:00`,
			end: `${FIRST}T10:00:00+00:00`,
			recurrenceRule: "FREQ=WEEKLY;COUNT=3",
		});
		written.set(series.calendarObjectId, series.calendarId);

		const expanded = await waitFor(
			() => api.listCalendarEvents(RANGE.from, RANGE.to),
			(items) =>
				items.filter(
					(item) => item.calendarObjectId === series.calendarObjectId,
				).length === 3,
			{ what: "the weekly series to be expanded into the window" },
		);
		const first = expanded.find(
			(item) => item.calendarObjectId === series.calendarObjectId,
		);
		expect(first?.start.slice(0, 10)).toBe(FIRST);

		await page.goto(
			`/calendar/month/${EMPTY_MONTH}/${series.calendarObjectId}`,
		);
		await expect(page).toHaveURL(
			new RegExp(
				`/calendar/month/${FIRST}/${series.calendarObjectId}/${encodeURIComponent(first?.recurrenceId ?? "")}(\\?|#|$)`,
			),
			{ timeout: 30_000 },
		);
		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();
		await expect(
			page.getByRole("button", { name: "This event" }),
		).toBeVisible();
	});
	test("opens a series in a hidden calendar at its next occurrence and shows that calendar (#1332)", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);
		const SUMMARY = "Fabrikam running sync";
		const today = new Date().toISOString().slice(0, 10);
		const FIRST = addDays(today, -56);

		const [shown] = await api.listCalendars();
		const shownId = shown?.calendarId ?? "";
		expect(shownId).not.toBe("");
		const hidden = await api.createCalendar({
			urlSegment: `hidden-${Date.now()}`,
			displayName: "Fabrikam hidden",
		});
		const series = await api.createCalendarEvent({
			calendarId: hidden.calendarId,
			summary: SUMMARY,
			start: `${FIRST}T09:00:00+00:00`,
			end: `${FIRST}T10:00:00+00:00`,
			recurrenceRule: "FREQ=WEEKLY;COUNT=20",
		});

		try {
			const RANGE = window(addDays(today, -1), addDays(today, 15));
			const around = await waitFor(
				() => api.listCalendarEvents(RANGE.from, RANGE.to),
				(items) =>
					items.some(
						(item) => item.calendarObjectId === series.calendarObjectId,
					),
				{ what: "the running series to be expanded around today" },
			);
			const next = around.find(
				(item) =>
					item.calendarObjectId === series.calendarObjectId &&
					Date.parse(item.end) > Date.now(),
			);
			if (!next) throw new Error("the series has no occurrence still to come");
			expect(next.start.slice(0, 10) > FIRST).toBe(true);

			await page.goto(
				`/calendar/week/2031-01-06/${series.calendarObjectId}?calendarId=${shownId}`,
			);
			await expect(page).toHaveURL(
				new RegExp(
					`/calendar/week/${next.start.slice(0, 10)}/${series.calendarObjectId}/${encodeURIComponent(next.recurrenceId)}\\?`,
				),
				{ timeout: 30_000 },
			);
			expect(
				new URL(page.url()).searchParams.getAll("calendarId").sort(),
			).toEqual([shownId, hidden.calendarId].sort());
			await expect(
				page.getByRole("button", { name: "Edit", exact: true }),
			).toBeVisible({ timeout: 30_000 });
		} finally {
			await api.deleteCalendarEvent(series.calendarObjectId, hidden.calendarId);
			await api.deleteCalendar(hidden.calendarId);
		}
	});
});
