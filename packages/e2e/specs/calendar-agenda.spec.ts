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
import type { Locator, Page } from "@playwright/test";
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

/** The day the address names, or `""` when it is not naming one at all. */
const pathDay = (page: Page): string =>
	/^\/calendar\/agenda\/(\d{4}-\d{2}-\d{2})$/.exec(
		new URL(page.url()).pathname,
	)?.[1] ?? "";

/** Which side of the day the strip opened on the address has reached. */
const dayInPath =
	(page: Page): (() => number) =>
	() =>
		pathDay(page).localeCompare(ANCHOR);

/** "31 days with nothing booked" — the run's own account of what it swallowed. */
const runDays = (text: string): number =>
	Number(/(\d+) days with nothing booked/.exec(text)?.[1] ?? 0);

/**
 * What the strip's sticky header stands clear of: its own height and the margin
 * the day under it is read at. A row has reached the header once it is this far
 * above the top of the pane.
 */
const HEADER_CLEARANCE = 40;

interface StripGeometry {
	/** The chrome above the strip, which a viewport height has to carry too. */
	above: number;
	content: number;
	pane: number;
	/**
	 * Where the row after the day the address opened on reaches the header. The
	 * first offset the reader can scroll to that leaves the address somewhere
	 * new to follow them to.
	 */
	boundary: number;
}

const geometryOf = (strip: Locator): Promise<StripGeometry> =>
	strip.evaluate((el, clearance) => {
		const rows = [...el.children].slice(1) as HTMLElement[];
		const opening = rows.findIndex((row) => row.querySelector("section"));
		const next = rows[opening + 1] ?? rows[rows.length - 1];
		return {
			above: Math.round(el.getBoundingClientRect().top),
			content: el.scrollHeight,
			pane: el.clientHeight,
			boundary: next.offsetTop - clearance,
		};
	}, HEADER_CLEARANCE);

/**
 * How far past that boundary the strip can be scrolled. Negative means the pane
 * is taller than the days the strip holds, so the reader can never bring a
 * later day under the header and the address has nothing to follow.
 */
const reachAtEnd = async (strip: Locator): Promise<number> => {
	const { content, pane, boundary } = await geometryOf(strip);
	return content - pane - boundary;
};

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

		const trailing = runs.last();
		const opened = runDays(await trailing.innerText());
		expect(opened).toBeGreaterThan(0);

		// Every week the strip asks for from here. A run that grows on its own
		// fetches one per layout pass, so this is the app's own account of whether
		// anything moved, and it needs no waiting to read.
		const weekReads: string[] = [];
		page.on("request", (request) => {
			if (request.url().includes("/calendar-events"))
				weekReads.push(request.url());
		});

		// Five weeks with two events in them are a handful of rows, so the pane is
		// cut down until the strip is a window onto its days rather than all of
		// them. Sized off the strip's own geometry: a reader who cannot bring a
		// later day under the header has nothing for the address to follow, and
		// every claim below would pass on an empty gesture.
		const drawn = await geometryOf(strip);
		await page.setViewportSize({
			width: DESKTOP.width,
			// One clearance shorter than the bound, so the boundary comes clear of
			// the header rather than landing exactly on it. The floor keeps a
			// pathological measurement out of Playwright's own error and leaves the
			// check below to say what actually went wrong.
			height: Math.max(
				160,
				drawn.above + drawn.content - drawn.boundary - HEADER_CLEARANCE,
			),
		});
		await expect
			.poll(() => reachAtEnd(strip), {
				message: "the pane to leave a day boundary above the fold",
			})
			.toBeGreaterThanOrEqual(0);

		// Two events five weeks apart draw shorter than the distance the strip
		// fetches at, so every end is within reach of itself on every layout pass
		// — and resizing the pane is a whole run of them. Nobody scrolled, so
		// nothing is asked for and the address stays on the day it was opened
		// with: the strip used to walk out to 2032 here, taking the path with it.
		expect(weekReads).toEqual([]);
		expect(runDays(await trailing.innerText())).toBe(opened);
		expect(pathDay(page)).toBe(ANCHOR);

		const history = await page.evaluate(() => window.history.length);

		// The reader's own scroll, which is the only thing that grows the run.
		await strip.hover();
		await page.mouse.wheel(0, 4_000);

		// Reaching the end grew the range by a week: the last run now accounts for
		// days the strip had never asked about when it opened.
		await expect
			.poll(async () => runDays(await trailing.innerText()), {
				message: "the strip to hold days past the range it opened with",
			})
			.toBeGreaterThan(opened);
		expect(weekReads).toHaveLength(1);

		// The day under the header is written back to the path, in the direction
		// the reader went: the end of the strip is later than the day it opened
		// on, so that is where the address has to be.
		await expect
			.poll(dayInPath(page), {
				message: "the address to follow the strip on to the days it reached",
			})
			.toBeGreaterThan(0);
		const landed = pathDay(page);
		expect(landed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		// Scrolling is not somewhere the reader went, so Back still belongs to the
		// screen they arrived from rather than to every row they passed.
		expect(await page.evaluate(() => window.history.length)).toBe(history);

		// The pane grows back around the strip and takes its scroll with it. That
		// is a scroll event with nobody behind it, so nothing is fetched and the
		// address stays where the reader left it.
		await page.setViewportSize(DESKTOP);
		await expect
			.poll(() => strip.evaluate((el) => el.scrollHeight - el.clientHeight), {
				message: "the pane to grow back past the strip and clamp its scroll",
			})
			.toBe(0);
		expect(weekReads).toHaveLength(1);
		expect(pathDay(page)).toBe(landed);

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
