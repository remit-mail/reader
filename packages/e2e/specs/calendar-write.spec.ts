/**
 * Writing an event from the calendar, proved against the server (#1033, A.3).
 *
 * The assertion is `GET /calendar-events` rather than anything on screen. A
 * grid that draws what it just posted from its own cache passes a pixel check
 * and stores nothing, which is the failure this exists to catch: what counts is
 * that the deployment expanded an occurrence and will serve it to the next
 * client that asks — a phone, a native client over CalDAV, a fresh tab.
 */
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };
test.use({ viewport: DESKTOP });

/**
 * A fixed week, so the window the spec reads back is the week it wrote into,
 * and one no other spec writes to — the read asserts an exact event on an exact
 * day, which a second writer on the same week would break.
 */
const DATE = "2026-06-10";
const WINDOW = {
	from: "2026-06-08T00:00:00+00:00",
	to: "2026-06-15T00:00:00+00:00",
};

const SUMMARY = "Northwind supplier call";
const REWRITTEN = "Northwind supplier call, rescheduled";

test.describe("Writing an event", () => {
	test("stores what the composer typed, and the server serves it back", async ({
		page,
		api,
	}) => {
		await page.goto(`/calendar/week/${DATE}/new`);

		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toBeVisible();
		await title.fill(SUMMARY);

		// What the form told the reader it was about to save. Which hour a blank
		// composer seeds is the composer's business and changing it is not a
		// regression; storing something other than what it showed is.
		const shownDate = await page
			.getByLabel("Date", { exact: true })
			.inputValue();
		const shownStart = await page
			.getByLabel("Start time", { exact: true })
			.inputValue();
		expect(shownDate).toBe(DATE);

		await page.getByRole("button", { name: "Add", exact: true }).click();

		// Read the refusal before the address, so a write the server turned down
		// fails with what it said rather than with a URL that did not change.
		await expect(page.getByRole("alert")).toHaveCount(0);

		// The composer is a route, so a saved event leaves it — proof the write
		// resolved rather than the button merely having been pressed.
		await expect(page).toHaveURL(new RegExp(`/calendar/week/${DATE}(\\?|$)`));

		const written = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => items.some((item) => item.summary === SUMMARY),
			{ what: `"${SUMMARY}" to be expanded into the visible window` },
		);

		const stored = written.find((item) => item.summary === SUMMARY);
		if (!stored) throw new Error(`"${SUMMARY}" was accepted but never served`);
		expect(stored.allDay).toBe(false);

		// The occurrence starts on the day and at the clock time the composer
		// displayed. Read off the string the API serves, which is the collection's
		// own clock — the same digits the form showed, whatever offset either of
		// them spells them with.
		expect(stored.start.slice(0, 10)).toBe(shownDate);
		expect(stored.start.slice(11, 16)).toBe(shownStart);

		const calendars = await api.listCalendars();
		expect(calendars.map((calendar) => calendar.calendarId)).toContain(
			stored.calendarId,
		);

		// An etag is only worth carrying if it moves. Every conditional write is
		// built on the version it names, so one that stayed put across a rewrite
		// would let an edit built on a version somebody has since replaced through
		// as if nothing had happened.
		expect(stored.etag).not.toBe("");
		await api.updateCalendarEvent(stored.calendarObjectId, stored.calendarId, {
			summary: REWRITTEN,
		});
		const rewritten = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => items.some((item) => item.summary === REWRITTEN),
			{ what: "the rewritten event to reach the server" },
		);
		expect(rewritten.find((item) => item.summary === REWRITTEN)?.etag).not.toBe(
			stored.etag,
		);

		// The suite shares one account, and a stray event on a fixed week would
		// be the next spec's surprise.
		await api.deleteCalendarEvent(stored.calendarObjectId, stored.calendarId);
	});
});
