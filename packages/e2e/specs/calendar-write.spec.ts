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

/** A fixed week, so the window the spec reads back is the week it wrote into. */
const DATE = "2026-06-10";
const WINDOW = {
	from: "2026-06-08T00:00:00+00:00",
	to: "2026-06-15T00:00:00+00:00",
};

const SUMMARY = "Northwind supplier call";

test.describe("Writing an event", () => {
	test("stores what the composer typed, and the server serves it back", async ({
		page,
		api,
	}) => {
		await page.goto(`/calendar/week/${DATE}/new`);

		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toBeVisible();
		await title.fill(SUMMARY);
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
		expect(stored).toBeTruthy();
		expect(stored?.allDay).toBe(false);
		expect(stored?.etag).toBeTruthy();

		// The composer opens at 09:00 on the calendar's own clock, and the default
		// collection is read as UTC. Compared as instants rather than as strings,
		// so the assertion is about where the event landed rather than about how
		// the server spells an offset.
		expect(Date.parse(stored?.start ?? "")).toBe(
			Date.parse(`${DATE}T09:00:00Z`),
		);

		const calendars = await api.listCalendars();
		expect(calendars.map((calendar) => calendar.calendarId)).toContain(
			stored?.calendarId,
		);

		// The suite shares one account, and a stray event on a fixed week would
		// be the next spec's surprise.
		if (stored)
			await api.deleteCalendarEvent(stored.calendarObjectId, stored.calendarId);
	});
});
