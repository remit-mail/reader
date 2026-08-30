/**
 * Editing and deleting from the calendar, proved against the server (#1033).
 *
 * A series is one object with one rule, so which occurrences a write reaches is
 * the whole of what the write means — and none of it shows in the grid, which
 * redraws from its own cache either way. Every claim below is therefore
 * `GET /calendar-events`: what the deployment will serve the next client that
 * asks, a phone or a native client over CalDAV included.
 */
import type {
	ApiClient,
	CalendarEventInstance,
	CalendarEventResource,
} from "../src/api.js";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };
/**
 * The grid draws on the device's clock and the default collection reads as UTC.
 * Running the browser on the same clock makes "which column, which slot" a fact
 * about the event rather than about the host the suite ran on.
 */
test.use({ viewport: DESKTOP, timezoneId: "UTC" });

/**
 * A fixed Monday, far enough out that today never falls in the weeks this spec
 * steps through: a series overlapping today would draw the now-line through the
 * column the assertions click in.
 */
const SERIES_START = "2031-04-07";
/** Five Mondays, so a truncation leaves a count worth asserting. */
const OCCURRENCES = 5;
const SERIES_RULE = `FREQ=WEEKLY;COUNT=${OCCURRENCES}`;

const SERIES = "Northwind weekly sync";
const RENAMED = "Northwind sync, agenda swap";
const ONE_OFF = "Northwind contract signing";

const addDays = (date: string, days: number): string => {
	const cursor = new Date(`${date}T00:00:00Z`);
	cursor.setUTCDate(cursor.getUTCDate() + days);
	return cursor.toISOString().slice(0, 10);
};

/** The Monday an occurrence falls on, which is also the week that draws it. */
const occurrenceDate = (index: number): string =>
	addDays(SERIES_START, index * 7);

const WINDOW = {
	from: `${SERIES_START}T00:00:00+00:00`,
	to: `${addDays(SERIES_START, 7 * (OCCURRENCES + 2))}T00:00:00+00:00`,
};

const weekPath = (date: string): string => `/calendar/week/${date}`;

const weekUrl = (date: string): RegExp =>
	new RegExp(`${weekPath(date)}(\\?|#|$)`);

const startDays = (items: CalendarEventInstance[]): string[] =>
	items.map((item) => item.start.slice(0, 10));

/**
 * The suite shares one account, so an event left behind is the next spec's
 * surprise. Registered as it is written, cleared however the test ends — a
 * resource the test already deleted answers 404, which is the same outcome.
 */
const written: CalendarEventResource[] = [];

test.afterEach(async ({ api }) => {
	while (written.length > 0) {
		const event = written.pop();
		if (event)
			await api.deleteCalendarEvent(event.calendarObjectId, event.calendarId);
	}
});

const defaultCalendarId = async (api: ApiClient): Promise<string> => {
	const calendars = await api.listCalendars();
	const calendarId = calendars[0]?.calendarId ?? "";
	expect(calendarId).not.toBe("");
	return calendarId;
};

test.describe("Editing a repeating event", () => {
	test("renames one occurrence and truncates the series from another", async ({
		page,
		api,
	}) => {
		test.setTimeout(180_000);

		const series = await api.createCalendarEvent({
			calendarId: await defaultCalendarId(api),
			summary: SERIES,
			start: `${SERIES_START}T10:00:00+00:00`,
			end: `${SERIES_START}T11:00:00+00:00`,
			recurrenceRule: SERIES_RULE,
		});
		written.push(series);

		const ofSeries = (items: CalendarEventInstance[]) =>
			items.filter((item) => item.calendarObjectId === series.calendarObjectId);

		const opened = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => ofSeries(items).length === OCCURRENCES,
			{ what: `the ${SERIES_RULE} series to be expanded into the window` },
		);
		expect(startDays(ofSeries(opened))).toEqual(
			[0, 1, 2, 3, 4].map(occurrenceDate),
		);

		// The second Monday, opened in the week that draws it. A weekly series has
		// one occurrence a week, so the address alone names the one that is meant.
		await page.goto(weekPath(occurrenceDate(1)));
		await page.getByRole("button", { name: SERIES }).click();

		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();

		// The scope is settled before the form opens, because which occurrences an
		// edit reaches changes what the edit is.
		await expect(
			page.getByText("What should the change apply to?"),
		).toBeVisible();
		await page.getByRole("button", { name: "This event" }).click();

		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toHaveValue(SERIES);
		await title.fill(RENAMED);
		await page.getByRole("button", { name: "Save", exact: true }).click();

		// The form is a state the pane is in, so a save that resolved leaves it —
		// a save the server refused stays put, with its reason where the reader is
		// looking.
		await expect(title).toHaveCount(0, { timeout: 30_000 });
		await expect(page.getByRole("alert")).toHaveCount(0);

		const renamed = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => ofSeries(items).some((item) => item.summary === RENAMED),
			{ what: "the renamed occurrence to reach the server" },
		);
		const overridden = ofSeries(renamed);
		// One Monday carries the new title and the series still has every Monday
		// it had. That is the whole of what "This event" means, and none of it is
		// visible in a grid that has just been told what it drew.
		expect(overridden).toHaveLength(OCCURRENCES);
		expect(overridden.filter((item) => item.summary === RENAMED)).toHaveLength(
			1,
		);
		expect(overridden.filter((item) => item.summary === SERIES)).toHaveLength(
			OCCURRENCES - 1,
		);
		expect(
			overridden.find((item) => item.summary === RENAMED)?.start.slice(0, 10),
		).toBe(occurrenceDate(1));

		// The fourth Monday, and everything after it. The rule itself is what
		// moves, so the Mondays behind it stay and the ones ahead of it go.
		await page.goto(weekPath(occurrenceDate(3)));
		await page.getByRole("button", { name: SERIES }).click();

		const remove = page.getByRole("button", { name: "Delete", exact: true });
		await expect(remove).toBeVisible({ timeout: 30_000 });
		await remove.click();
		await page
			.getByRole("button", { name: "This and everything after" })
			.click();

		// The open event is a route, so a delete that resolved leaves it.
		await expect(page).toHaveURL(weekUrl(occurrenceDate(3)), {
			timeout: 30_000,
		});

		const truncated = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => ofSeries(items).length === 3,
			{ what: "the series to end just before its fourth occurrence" },
		);
		expect(startDays(ofSeries(truncated))).toEqual(
			[0, 1, 2].map(occurrenceDate),
		);
	});

	// An event that repeats never has one honest answer to the scope question,
	// so it is never asked: Delete deletes it.
	test("deletes an event that repeats never without asking what it means", async ({
		page,
		api,
	}) => {
		test.setTimeout(120_000);

		const single = await api.createCalendarEvent({
			calendarId: await defaultCalendarId(api),
			summary: ONE_OFF,
			start: `${occurrenceDate(6)}T14:00:00+00:00`,
			end: `${occurrenceDate(6)}T15:00:00+00:00`,
		});
		written.push(single);

		await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => items.some((item) => item.summary === ONE_OFF),
			{ what: `"${ONE_OFF}" to be expanded into the window` },
		);

		await page.goto(weekPath(occurrenceDate(6)));
		await page.getByRole("button", { name: ONE_OFF }).click();

		const remove = page.getByRole("button", { name: "Delete", exact: true });
		await expect(remove).toBeVisible({ timeout: 30_000 });
		await remove.click();

		await expect(
			page.getByText("What should the change apply to?"),
		).toHaveCount(0);
		await expect(page).toHaveURL(weekUrl(occurrenceDate(6)), {
			timeout: 30_000,
		});

		await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => !items.some((item) => item.summary === ONE_OFF),
			{ what: `"${ONE_OFF}" to be gone from the server` },
		);
	});
});
