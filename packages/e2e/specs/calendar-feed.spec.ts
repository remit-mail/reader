/**
 * Subscribing to a calendar from outside the session (#1067).
 *
 * The address is minted in settings and then used the way a calendar client
 * uses it: a bare HTTP GET carrying no cookie, no bearer and no origin. That is
 * the whole point of the feature and the one thing no in-app assertion can
 * stand in for — a fetch made through the suite's authenticated client would
 * pass against a feed the edge still gates, and every Apple Calendar and
 * Thunderbird subscription would 401.
 *
 * Revoking is asserted the same way. A UI that says "not shared" over an
 * address the server still answers is the failure that matters here.
 */
import { waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };
test.use({ viewport: DESKTOP });

/** A week no other spec writes into, so the feed's contents are this spec's. */
const WINDOW = {
	from: "2026-09-07T00:00:00+00:00",
	to: "2026-09-14T00:00:00+00:00",
};

const SUMMARY = "Harbour pilot handover";

/** The address as a calendar client would dial it. `webcal:` is not a scheme
 *  `fetch` speaks, and it means the same host and path over HTTP. */
const dialable = (webcalUrl: string): string =>
	webcalUrl.replace(/^webcal:\/\//, "http://");

test.describe("Subscribing to a calendar", () => {
	test("serves the calendar to whoever holds the address, until it is revoked", async ({
		page,
		api,
	}) => {
		const calendars = await api.listCalendars();
		const calendar = calendars[0];
		if (!calendar) throw new Error("the account holds no calendar");

		const event = await api.createCalendarEvent({
			calendarId: calendar.calendarId,
			summary: SUMMARY,
			start: "2026-09-09T09:00:00+02:00",
			end: "2026-09-09T10:00:00+02:00",
		});
		await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => items.some((item) => item.summary === SUMMARY),
			{ what: `"${SUMMARY}" to reach the calendar` },
		);

		await page.goto("/settings/calendars");

		// The account holds more than one calendar and every card words its
		// controls the same way, so each locator is scoped to this calendar's.
		const card = page.getByRole("region", { name: calendar.displayName });

		const create = card.getByRole("button", {
			name: "Create subscription address",
		});
		await expect(create).toBeVisible({ timeout: 30_000 });
		await create.click();

		const address = card.getByLabel(
			`Subscription address for ${calendar.displayName}`,
		);
		await expect(address).toBeVisible();

		// Only once the address is on screen: a write the server turned down
		// leaves a banner here, and asserting no alert before the PUT has answered
		// passes on a card that has not done anything yet.
		await expect(card.getByRole("alert")).toHaveCount(0);

		const webcalUrl = await address.inputValue();
		expect(webcalUrl).toMatch(/^webcal:\/\/.+\/feeds\/calendar\/.+\.ics$/);
		expect(webcalUrl).toContain(new URL(baseUrl).host);

		// No cookie jar, no Authorization, no origin — a calendar client and
		// nothing more.
		const served = await fetch(dialable(webcalUrl));
		expect(served.status).toBe(200);
		expect(served.headers.get("content-type")).toContain("text/calendar");

		const ical = await served.text();
		expect(ical).toContain("BEGIN:VCALENDAR");
		expect(ical).toContain("END:VCALENDAR");
		expect(ical).toContain(SUMMARY);

		await card.getByRole("button", { name: "Stop sharing" }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Stop sharing" })
			.click();
		await expect(create).toBeVisible();

		const refused = await fetch(dialable(webcalUrl));
		expect(refused.status).toBe(404);

		await api.deleteCalendarEvent(event.calendarObjectId, calendar.calendarId);
	});
});
