/**
 * The day strip, proved against the deployment (#1033, C.3).
 *
 * Two events five weeks apart is the case the strip exists for: the days that
 * hold something get a row each, and the week between them is one sentence
 * rather than seven blank screens. Every claim here is one a reader makes —
 * what is on screen, what the address says, whether Back goes anywhere — held
 * against `GET /calendar-events` and `GET /calendar-free-busy`, so a strip
 * drawing its own cache back at itself cannot pass.
 */
import type { CalendarEventResource } from "../src/api.js";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };
test.use({ viewport: DESKTOP });

/**
 * Far enough out that today never falls inside the days the strip holds. Today
 * and the day the address names are the two days the strip refuses to collapse,
 * so today wandering into the gap would break the run apart and the assertion
 * would depend on the date the suite ran.
 */
const ANCHOR = "2030-05-15";
const BANNER_DATE = "2030-05-22";
/** The days between them, which is what one collapsed band has to account for. */
const GAP_DAYS = 6;

const TIMED = "Northwind quarterly review";
const BANNER = "Northwind audit day";

const addDays = (date: string, days: number): string => {
	const cursor = new Date(`${date}T00:00:00Z`);
	cursor.setUTCDate(cursor.getUTCDate() + days);
	return cursor.toISOString().slice(0, 10);
};

const startOfDay = (date: string): string => `${date}T00:00:00+00:00`;

const dayNumber = (date: string): string => String(Number(date.slice(8)));

const agendaPath = (date: string): string => `/calendar/agenda/${date}`;

/** "31 days with nothing booked" — the run's own account of what it swallowed. */
const runDays = (text: string): number =>
	Number(/(\d+) days with nothing booked/.exec(text)?.[1] ?? 0);

/**
 * The suite shares one account, so an event left behind is the next spec's
 * surprise. Registered as it is written, cleared however the test ends.
 */
const written: CalendarEventResource[] = [];

test.afterEach(async ({ api }) => {
	while (written.length > 0) {
		const event = written.pop();
		if (event)
			await api.deleteCalendarEvent(event.calendarObjectId, event.calendarId);
	}
});

test.describe("The agenda strip", () => {
	test("draws the booked days, collapses the week between them, and follows the scroll", async ({
		page,
		api,
	}) => {
		const calendars = await api.listCalendars();
		const calendarId = calendars[0]?.calendarId ?? "";
		expect(calendarId).not.toBe("");

		written.push(
			await api.createCalendarEvent({
				calendarId,
				summary: TIMED,
				start: `${ANCHOR}T12:00:00+00:00`,
				end: `${ANCHOR}T13:00:00+00:00`,
			}),
		);
		written.push(
			await api.createCalendarEvent({
				calendarId,
				summary: BANNER,
				start: BANNER_DATE,
				end: addDays(BANNER_DATE, 1),
				allDay: true,
			}),
		);

		// What the deployment will serve the next client that asks. The strip is
		// held against this rather than against the two writes, so an event that
		// was accepted but never expanded fails here and not on a pixel.
		const shownWindow = {
			from: startOfDay(ANCHOR),
			to: startOfDay(addDays(BANNER_DATE, 1)),
		};
		const stored = await waitFor(
			() => api.listCalendarEvents(shownWindow.from, shownWindow.to),
			(items) =>
				[TIMED, BANNER].every((summary) =>
					items.some((item) => item.summary === summary),
				),
			{ what: "both events to be expanded into the window the strip draws" },
		);

		const timed = stored.find((item) => item.summary === TIMED);
		const banner = stored.find((item) => item.summary === BANNER);
		expect(timed?.start.slice(0, 10)).toBe(ANCHOR);
		expect(timed?.allDay).toBe(false);
		expect(banner?.start.slice(0, 10)).toBe(BANNER_DATE);
		expect(banner?.allDay).toBe(true);

		// The days in between hold nothing at all, which is the server's own
		// grounds for the one line the strip draws over them.
		const between = stored.filter((item) => {
			const day = item.start.slice(0, 10);
			return day > ANCHOR && day < BANNER_DATE;
		});
		expect(between).toEqual([]);

		// The free stretches the strip draws come from merged busy time rather
		// than from the rows it has, so the day's own busy span is what a free
		// band is measured against.
		const busy = await api.listCalendarFreeBusy(
			startOfDay(ANCHOR),
			startOfDay(addDays(ANCHOR, 1)),
		);
		expect(busy).toHaveLength(1);

		await page.goto(`${agendaPath(ANCHOR)}?calendarId=${calendarId}`);

		const strip = page.getByTestId("agenda-strip");
		const days = strip.locator("section");
		const runs = strip.getByRole("button", {
			name: /days with nothing booked/,
		});

		// Five weeks of days, two of which have something on them. Anything else
		// with a row of its own means the empty days were not collapsed.
		await expect(days).toHaveCount(2);

		const timedDay = days.filter({ hasText: TIMED });
		const bannerDay = days.filter({ hasText: BANNER });
		await expect(timedDay).toHaveCount(1);
		await expect(bannerDay).toHaveCount(1);
		await expect(
			timedDay.getByText(dayNumber(ANCHOR), { exact: true }),
		).toBeVisible();
		await expect(
			bannerDay.getByText(dayNumber(BANNER_DATE), { exact: true }),
		).toBeVisible();
		await expect(bannerDay).toContainText("All day");

		// One band for the days before the first event, one for the week between
		// them, one for the days after the second.
		await expect(runs).toHaveCount(3);
		await expect(runs.nth(1)).toContainText(
			`${GAP_DAYS} days with nothing booked`,
		);

		// The afternoon around the one timed event, offered as time to book.
		const free = timedDay.getByRole("button", { name: /free/ });
		await expect(free.first()).toBeVisible();
		await expect(free.first()).toContainText(/\d+h( \d+m)? free/);

		// The strip scrolls only when it is taller than the pane holding it, and
		// five weeks with two events in them are a handful of rows. A short window
		// is the honest way to get a scrollbar, rather than inventing a diary the
		// rest of this test is not about.
		await page.setViewportSize({ width: DESKTOP.width, height: 320 });
		await expect
			.poll(() => strip.evaluate((el) => el.scrollHeight - el.clientHeight), {
				message: "the strip to stand taller than the pane holding it",
			})
			.toBeGreaterThan(0);

		const trailing = runs.last();
		const held = runDays(await trailing.innerText());
		expect(held).toBeGreaterThan(0);

		const history = await page.evaluate(() => window.history.length);

		await strip.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});

		// Reaching the end grew the range: the last run now accounts for days the
		// strip had never asked about when it opened.
		await expect
			.poll(async () => runDays(await trailing.innerText()), {
				message: "the strip to hold days past the range it opened with",
			})
			.toBeGreaterThan(held);

		await strip.evaluate((el) => {
			el.scrollTop = 0;
		});

		// The day under the header is written back to the path, and Back still
		// belongs to the screen the reader arrived from rather than to every row
		// they passed on the way.
		await expect
			.poll(() => new URL(page.url()).pathname, {
				message: "the address to follow the strip to the day it scrolled to",
			})
			.not.toBe(agendaPath(ANCHOR));
		const scrolled = new URL(page.url()).pathname;
		expect(scrolled).toMatch(/^\/calendar\/agenda\/\d{4}-\d{2}-\d{2}$/);
		// Behind the day it opened on, which is where the reader scrolled to.
		const landed = scrolled.split("/").pop() ?? "";
		expect(landed.localeCompare(ANCHOR)).toBeLessThan(0);
		expect(await page.evaluate(() => window.history.length)).toBe(history);

		await page.setViewportSize(DESKTOP);

		// Changing zoom keeps the day and the ticked calendars: the grid is a
		// magnification the reader drops into, not a different screen.
		await page
			.getByRole("group", { name: "Calendar view" })
			.getByText("Week", { exact: true })
			.click();

		await expect
			.poll(() => new URL(page.url()).pathname)
			.toBe(`/calendar/week/${landed}`);
		expect(new URL(page.url()).searchParams.getAll("calendarId")).toEqual([
			calendarId,
		]);
	});
});
