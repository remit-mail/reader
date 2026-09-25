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

/**
 * The column a timed occurrence is drawn in. The grid engine keys each day's
 * column by its date, and that date is the claim under test.
 */
const dayColumn = (page: Page, date: string) =>
	page.locator(`.fc-timegrid-col[data-date="${date}"]`);

const expectDrawnOn = async (
	page: Page,
	summary: string,
	weekOf: string,
	days: string[],
): Promise<void> => {
	await page.goto(weekPath(weekOf));
	for (let offset = 0; offset < 7; offset += 1) {
		const day = addDays(weekOf, offset);
		await expect(
			dayColumn(page, day).getByRole("button", { name: summary }),
		).toHaveCount(days.includes(day) ? 1 : 0, { timeout: 30_000 });
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
