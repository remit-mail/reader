/**
 * Moving through the week and day views, proved against the deployment (#1271).
 *
 * Every range the grid draws is held against `GET /calendar-events` for that
 * same range: the events the server expands into it are the events on screen,
 * each on the day the server says it starts, and nothing from a neighbouring
 * range leaks in. The address is checked alongside, because the address is the
 * view — a reload or a pasted link has to land on exactly what was on screen.
 */
import type { Page } from "@playwright/test";
import type { ApiClient, CalendarEventResource } from "../src/api.js";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

const TIME_ZONE = "Europe/Amsterdam";
/** Every day below is in February, so the zone sits at +01:00 throughout. */
const OFFSET = "+01:00";

/** Mondays, far enough out that today is never one of the days in play. */
const WEEK = "2031-02-10";
const PREVIOUS_WEEK = "2031-02-03";
const NEXT_WEEK = "2031-02-17";

const PREFIX = "Navtest";
const EVENTS = [
	{
		summary: `${PREFIX} kickoff`,
		day: "2031-02-10",
		from: "10:00",
		to: "11:00",
	},
	{
		summary: `${PREFIX} review`,
		day: "2031-02-13",
		from: "14:00",
		to: "15:00",
	},
	{
		summary: `${PREFIX} early call`,
		day: "2031-02-12",
		from: "06:30",
		to: "07:00",
	},
	{
		summary: `${PREFIX} late call`,
		day: "2031-02-12",
		from: "23:15",
		to: "23:45",
	},
	{ summary: `${PREFIX} retro`, day: "2031-02-05", from: "12:00", to: "13:00" },
	{
		summary: `${PREFIX} planning`,
		day: "2031-02-18",
		from: "09:00",
		to: "10:00",
	},
] as const;

const addDays = (date: string, days: number): string => {
	const cursor = new Date(`${date}T00:00:00Z`);
	cursor.setUTCDate(cursor.getUTCDate() + days);
	return cursor.toISOString().slice(0, 10);
};

const daysFrom = (start: string, count: number): string[] =>
	Array.from({ length: count }, (_, index) => addDays(start, index));

const localMidnight = (date: string): string => `${date}T00:00:00${OFFSET}`;

/** The day an instant falls on in the zone the browser runs in. */
const localDay = (instant: string): string =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone: TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date(instant));

/**
 * What the server says is on each day of a range, as summary → day. The grid
 * asks for the same window, so this is the one account the screen has to match.
 */
async function serverDays(
	api: ApiClient,
	first: string,
	count: number,
): Promise<Map<string, string>> {
	const from = localMidnight(first);
	const to = localMidnight(addDays(first, count));
	const expected = EVENTS.filter(
		(event) => event.day >= first && event.day < addDays(first, count),
	).map((event) => event.summary);
	const items = await waitFor(
		() => api.listCalendarEvents(from, to),
		(found) =>
			expected.every((summary) =>
				found.some((item) => item.summary === summary),
			),
		{ what: `every event from ${first} to be expanded into its range` },
	);
	return new Map(
		items
			.filter((item) => item.summary.startsWith(PREFIX))
			.map((item) => [item.summary, localDay(item.start)]),
	);
}

/** The day columns the grid has drawn, from the dates it stamps on them. */
const drawnDays = (page: Page): Promise<string[]> =>
	page
		.getByTestId("calendar-grid")
		.locator("[data-date]")

		.evaluateAll((cells) => [
			...new Set(
				cells
					.map((cell) => cell.getAttribute("data-date") ?? "")
					.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
			),
		])
		.then((dates) => dates.sort());

/**
 * Every test event the grid draws, and the day column it sits in. Read off the
 * DOM rather than a screenshot: an event is on a day when the column stamped
 * with that date holds it.
 */
const drawnEvents = (page: Page): Promise<Record<string, string>> =>
	page
		.getByTestId("calendar-grid")
		.evaluate(
			(grid, prefix) =>
				Object.fromEntries(
					[...grid.querySelectorAll("*")]
						.filter(
							(node) =>
								node.children.length === 0 &&
								(node.textContent ?? "").startsWith(prefix),
						)
						.map((node) => [
							node.textContent ?? "",
							node.closest("[data-date]")?.getAttribute("data-date") ?? "",
						]),
				),
			PREFIX,
		);

const pathOf = (page: Page): string => new URL(page.url()).pathname;

/**
 * The grid matches the server for the range the address names: the days drawn
 * are that range, and every event the server serves in it is on its own day.
 */
async function expectRange(
	page: Page,
	api: ApiClient,
	view: "week" | "day",
	date: string,
	first: string,
): Promise<void> {
	const count = view === "week" ? 7 : 1;
	await expect.poll(() => pathOf(page)).toBe(`/calendar/${view}/${date}`);
	await expect
		.poll(() => drawnDays(page), {
			message: `the grid to draw the ${view} of ${date}`,
		})
		.toEqual(daysFrom(first, count));
	// The toolbar names the range on screen, not the one it came from.
	const last = addDays(first, count - 1);
	const dayOfMonth = (day: string): string => String(Number(day.slice(8)));
	const title = page
		.getByRole("button", { name: "Today", exact: true })
		.locator("xpath=following-sibling::h2");
	await expect(title).toContainText(first.slice(0, 4));
	const span =
		first === last
			? `\\b${dayOfMonth(first)}\\b`
			: `\\b${dayOfMonth(first)}\\b.*\\b${dayOfMonth(last)}\\b`;
	await expect(title).toContainText(new RegExp(span));
	const server = Object.fromEntries(await serverDays(api, first, count));
	await expect
		.poll(() => drawnEvents(page), {
			message: `the ${view} of ${date} to draw what the server serves for it`,
		})
		.toEqual(server);
}

/**
 * The middle of one slot in one day's column. The slot rows sit under the day
 * lanes, so a tap lands on the lane at the height of the row.
 */
async function slotPoint(
	page: Page,
	day: string,
	time: string,
): Promise<{ x: number; y: number }> {
	const grid = page.getByTestId("calendar-grid");
	const row = grid.locator(`[data-time="${time}"]`).last();
	await row.scrollIntoViewIfNeeded();
	const rowBox = await row.boundingBox();
	const lanes = await grid
		.locator(`[data-date="${day}"]`)
		.evaluateAll((cells) =>
			cells.map((cell) => {
				const box = cell.getBoundingClientRect();
				return { x: box.x, width: box.width, height: box.height };
			}),
		);
	const lane = lanes.sort((a, b) => b.height - a.height)[0];
	if (!rowBox || !lane) throw new Error(`no slot at ${time} on ${day}`);
	return { x: lane.x + lane.width / 2, y: rowBox.y + rowBox.height / 2 };
}

/**
 * Every control the toolbar offers, and the grid under it, inside the screen.
 * A toolbar wider than a phone pushes the grid out from under the reader's
 * thumb and leaves the controls past its edge unreachable.
 */
async function expectOnScreen(page: Page): Promise<void> {
	const width = page.viewportSize()?.width ?? 0;
	const controls = [
		page.getByRole("button", { name: "Open folders" }),
		page.getByRole("button", { name: "Previous", exact: true }),
		page.getByRole("button", { name: "Next", exact: true }),
		page.getByRole("button", { name: "Today", exact: true }),
		page.getByRole("group", { name: "Calendar view" }),
		page.getByRole("group", { name: "Calendar density" }),
		page.getByTestId("calendar-grid"),
	];
	for (const control of controls) {
		await expect(control).toBeVisible();
		const box = await control.boundingBox();
		expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
		expect((box?.x ?? 0) + (box?.width ?? width + 1)).toBeLessThanOrEqual(
			width,
		);
	}
}

const todayInBrowser = (page: Page): Promise<string> =>
	page.evaluate(() => {
		const now = new Date();
		const pad = (value: number): string => String(value).padStart(2, "0");
		return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	});

const mondayOf = (date: string): string => {
	const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
	return addDays(date, -((weekday + 6) % 7));
};

const written: Pick<
	CalendarEventResource,
	"calendarObjectId" | "calendarId"
>[] = [];

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ api }) => {
	const calendarId = (await api.listCalendars())[0]?.calendarId ?? "";
	expect(calendarId).not.toBe("");
	for (const event of EVENTS) {
		written.push(
			await api.createCalendarEvent({
				calendarId,
				summary: event.summary,
				start: `${event.day}T${event.from}:00${OFFSET}`,
				end: `${event.day}T${event.to}:00${OFFSET}`,
			}),
		);
	}
});

test.afterEach(async ({ api }) => {
	while (written.length > 0) {
		const event = written.pop();
		if (event)
			await api.deleteCalendarEvent(event.calendarObjectId, event.calendarId);
	}
});

test.describe("Navigating the calendar", () => {
	test.use({ viewport: { width: 1512, height: 864 } });

	test("a week draws its events on their days, and Previous, Next and Today move it", async ({
		page,
		api,
	}) => {
		// A Wednesday: the week it names starts on the Monday before it.
		const wednesday = addDays(WEEK, 2);
		await page.goto(`/calendar/week/${wednesday}`);
		await expectRange(page, api, "week", wednesday, WEEK);

		const nav = page.getByRole("button", { name: "Next", exact: true });
		const back = page.getByRole("button", { name: "Previous", exact: true });

		await nav.click();
		await expectRange(page, api, "week", addDays(wednesday, 7), NEXT_WEEK);

		await back.click();
		await back.click();
		await expectRange(page, api, "week", addDays(wednesday, -7), PREVIOUS_WEEK);

		// Each step is a place, so Back walks the weeks the reader passed through.
		await page.goBack();
		await expectRange(page, api, "week", wednesday, WEEK);
		await page.goForward();
		await expectRange(page, api, "week", addDays(wednesday, -7), PREVIOUS_WEEK);

		await page.getByRole("button", { name: "Today", exact: true }).click();
		const today = await todayInBrowser(page);
		await expect.poll(() => pathOf(page)).toBe(`/calendar/week/${today}`);
		await expect
			.poll(() => drawnDays(page))
			.toEqual(daysFrom(mondayOf(today), 7));
	});

	test("the day view draws that day's events and steps a day at a time", async ({
		page,
		api,
	}) => {
		await page.goto(`/calendar/week/${WEEK}`);
		await expectRange(page, api, "week", WEEK, WEEK);

		await page
			.getByRole("group", { name: "Calendar view" })
			.getByText("Day", { exact: true })
			.click();
		await expectRange(page, api, "day", WEEK, WEEK);

		const next = page.getByRole("button", { name: "Next", exact: true });
		await next.click();
		await expectRange(page, api, "day", addDays(WEEK, 1), addDays(WEEK, 1));
		await next.click();
		const busyDay = addDays(WEEK, 2);
		await expectRange(page, api, "day", busyDay, busyDay);

		await page.getByRole("button", { name: "Previous", exact: true }).click();
		await expectRange(page, api, "day", addDays(WEEK, 1), addDays(WEEK, 1));

		await page.getByRole("button", { name: "Today", exact: true }).click();
		const today = await todayInBrowser(page);
		await expect.poll(() => pathOf(page)).toBe(`/calendar/day/${today}`);
		await expect.poll(() => drawnDays(page)).toEqual([today]);

		await page
			.getByRole("group", { name: "Calendar view" })
			.getByText("Week", { exact: true })
			.click();
		await expect.poll(() => pathOf(page)).toBe(`/calendar/week/${today}`);
		await expect
			.poll(() => drawnDays(page))
			.toEqual(daysFrom(mondayOf(today), 7));
	});

	test("a week address and a day address load straight into their range", async ({
		page,
		api,
	}) => {
		await page.goto(`/calendar/week/${NEXT_WEEK}`);
		await expectRange(page, api, "week", NEXT_WEEK, NEXT_WEEK);

		const busyDay = addDays(WEEK, 2);
		await page.goto(`/calendar/day/${busyDay}`);
		await expectRange(page, api, "day", busyDay, busyDay);

		// Landing somewhere and moving on from it survives a reload: the address
		// alone rebuilds the range.
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await expectRange(
			page,
			api,
			"day",
			addDays(busyDay, 1),
			addDays(busyDay, 1),
		);
		await page.reload();
		await expectRange(
			page,
			api,
			"day",
			addDays(busyDay, 1),
			addDays(busyDay, 1),
		);
	});
});

test.describe("The calendar on a phone", () => {
	test.use({
		viewport: { width: 411, height: 759 },
		hasTouch: true,
		isMobile: true,
	});

	test("creates an event from a tapped slot and opens it", async ({
		page,
		api,
	}) => {
		const day = addDays(WEEK, 1);
		const summary = `${PREFIX} phone booking`;
		await page.goto(`/calendar/week/${day}`);
		await expectRange(page, api, "week", day, WEEK);

		await expectOnScreen(page);
		await page
			.getByRole("group", { name: "Calendar view" })
			.getByText(/^(Day|D)$/)
			.click();
		await expectRange(page, api, "day", day, day);

		await expectOnScreen(page);
		const slot = await slotPoint(page, day, "10:00:00");
		await page.touchscreen.tap(slot.x, slot.y);
		await expect.poll(() => pathOf(page)).toBe(`/calendar/day/${day}/new`);

		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toBeVisible();
		await title.fill(summary);
		await expect(page.getByLabel("Date", { exact: true })).toHaveValue(day);
		await expect(page.getByLabel("Start time", { exact: true })).toHaveValue(
			"10:00",
		);
		await page.getByRole("button", { name: "Add", exact: true }).click();
		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect.poll(() => pathOf(page)).toBe(`/calendar/day/${day}`);

		const stored = await waitFor(
			() =>
				api.listCalendarEvents(
					localMidnight(day),
					localMidnight(addDays(day, 1)),
				),
			(items) => items.some((item) => item.summary === summary),
			{ what: `"${summary}" to be served for the day it was booked on` },
		);
		const booked = stored.find((item) => item.summary === summary);
		if (!booked) throw new Error(`"${summary}" was accepted but never served`);
		written.push(booked);
		expect(localDay(booked.start)).toBe(day);

		await expect.poll(() => drawnEvents(page)).toEqual({ [summary]: day });

		await page.getByTestId("calendar-grid").getByText(summary).click();
		await expect
			.poll(() => pathOf(page))
			.toBe(`/calendar/day/${day}/${booked.calendarObjectId}`);
		await expect(
			page.getByRole("heading", { name: summary, level: 1 }),
		).toBeVisible();

		await page.getByRole("button", { name: "Close event" }).click();
		await expect.poll(() => pathOf(page)).toBe(`/calendar/day/${day}`);
		await expect.poll(() => drawnEvents(page)).toEqual({ [summary]: day });
	});
});
