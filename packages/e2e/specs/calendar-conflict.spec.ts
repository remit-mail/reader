/**
 * The three ways a calendar week can lie, and what the deployment does instead
 * (#1033).
 *
 * A grid drawn from the client's own cache looks the same whether the write
 * landed, whether the calendar behind it is hidden, and whether the session is
 * gone. Each test here makes one of those true and holds the screen against
 * `GET /calendar-events`: an edit built on a version somebody has replaced is
 * refused out loud, a calendar the address left unticked is absent because the
 * reader said so, and a read the server turned down says so rather than
 * drawing an empty week.
 */
import type { CalendarEventResource } from "../src/api.js";
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
 * A fixed Monday, far enough out that today never falls in the week under test:
 * a week holding today draws the now-line through the column being read.
 */
const WEEK = "2031-09-08";

const WINDOW = {
	from: `${WEEK}T00:00:00+00:00`,
	to: "2031-09-15T00:00:00+00:00",
};

const AS_READ = "Northwind rate review";
const AS_STORED = "Northwind rate review, moved by the other tab";
const AS_TYPED = "Northwind rate review, my version";

const IN_DEFAULT = "Northwind delivery window";
const IN_SECOND = "Northwind site visit";
const SECOND_CALENDAR = {
	urlSegment: "northwind-projects",
	displayName: "Projects",
};

const weekPath = `/calendar/week/${WEEK}`;

/** The suite shares one account, so everything a test writes it takes back. */
const written: CalendarEventResource[] = [];
const collections: string[] = [];

test.afterEach(async ({ api }) => {
	while (written.length > 0) {
		const event = written.pop();
		if (event)
			await api.deleteCalendarEvent(event.calendarObjectId, event.calendarId);
	}
	while (collections.length > 0) {
		const calendarId = collections.pop();
		if (calendarId) await api.deleteCalendar(calendarId);
	}
});

test.describe("A week the calendar must not draw as it pleases", () => {
	test("states the edit somebody else got in first with, and keeps their version", async ({
		page,
		api,
	}) => {
		test.setTimeout(120_000);

		const calendars = await api.listCalendars();
		const calendarId = calendars[0]?.calendarId ?? "";
		expect(calendarId).not.toBe("");

		const event = await api.createCalendarEvent({
			calendarId,
			summary: AS_READ,
			start: `${WEEK}T10:00:00+00:00`,
			end: `${WEEK}T11:00:00+00:00`,
		});
		written.push(event);
		await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => items.some((item) => item.summary === AS_READ),
			{ what: `"${AS_READ}" to be expanded into the week` },
		);

		await page.goto(weekPath);
		await page.getByRole("button", { name: AS_READ }).click();

		// Edit appears once the resource behind the occurrence is read, which is
		// also when the browser has the etag its write will be conditional on.
		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });

		// Somebody else — another tab, a CalDAV client, an accepted invitation —
		// replaces the resource. The browser is still holding the version it read.
		await api.updateCalendarEvent(event.calendarObjectId, calendarId, {
			summary: AS_STORED,
		});

		await edit.click();
		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toBeVisible();
		await title.fill(AS_TYPED);
		await page.getByRole("button", { name: "Save", exact: true }).click();

		// Said where the reader is looking, and the form stays up with what they
		// typed still in it: nothing was saved and nothing was thrown away.
		const refusal = page.getByRole("alert");
		await expect(refusal).toContainText("changed somewhere else", {
			timeout: 30_000,
		});
		await expect(title).toHaveValue(AS_TYPED);

		// The other writer's version is the one that stands. A save that had
		// quietly won would read back as what this browser typed.
		const stored = await api.listCalendarEvents(WINDOW.from, WINDOW.to);
		const kept = stored.filter(
			(item) => item.calendarObjectId === event.calendarObjectId,
		);
		expect(kept.map((item) => item.summary)).toEqual([AS_STORED]);
	});

	test("draws only the calendars the address ticked", async ({ page, api }) => {
		test.setTimeout(120_000);

		const calendars = await api.listCalendars();
		const defaultCalendarId = calendars[0]?.calendarId ?? "";
		expect(defaultCalendarId).not.toBe("");

		const second = await api.createCalendar(SECOND_CALENDAR);
		collections.push(second.calendarId);

		written.push(
			await api.createCalendarEvent({
				calendarId: defaultCalendarId,
				summary: IN_DEFAULT,
				start: `${WEEK}T09:00:00+00:00`,
				end: `${WEEK}T10:00:00+00:00`,
			}),
		);
		written.push(
			await api.createCalendarEvent({
				calendarId: second.calendarId,
				summary: IN_SECOND,
				start: `${WEEK}T14:00:00+00:00`,
				end: `${WEEK}T15:00:00+00:00`,
			}),
		);

		// Both are on the server, in the week the address names. Whatever the
		// screen shows next is the tick list's doing and nothing else.
		await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) =>
				[IN_DEFAULT, IN_SECOND].every((summary) =>
					items.some((item) => item.summary === summary),
				),
			{ what: "both events to be expanded into the week" },
		);

		await page.goto(`${weekPath}?calendarId=${defaultCalendarId}`);
		await expect(page.getByRole("button", { name: IN_DEFAULT })).toBeVisible({
			timeout: 30_000,
		});
		// The absence is the assertion, and it is only worth making beside the
		// event that did draw: an empty grid would satisfy the first half alone.
		await expect(page.getByRole("button", { name: IN_SECOND })).toHaveCount(0);

		await page.goto(
			`${weekPath}?calendarId=${defaultCalendarId}&calendarId=${second.calendarId}`,
		);
		await expect(page.getByRole("button", { name: IN_SECOND })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole("button", { name: IN_DEFAULT })).toBeVisible();
	});

	// A read refused for want of a session drawn as a week with nothing in it is
	// indistinguishable from a free week: the reader concludes they have nothing
	// on and never learns they are signed out.
	test("says a week it could not read, rather than drawing it empty", async ({
		page,
	}) => {
		test.setTimeout(120_000);

		await page.route(/\/calendar-events\?/, (route) =>
			route.fulfill({
				status: 401,
				contentType: "application/json",
				body: JSON.stringify({ message: "Session expired" }),
			}),
		);

		await page.goto(weekPath);

		// The grid says what it could not do, in place of the week it has not got.
		await expect(page.getByText("Couldn't load this week")).toBeVisible({
			timeout: 30_000,
		});
		// And the session going takes the screen, because no banner signs anyone
		// back in.
		await expect(page.getByTestId("fatal-error-overlay")).toBeVisible({
			timeout: 30_000,
		});
	});
});
