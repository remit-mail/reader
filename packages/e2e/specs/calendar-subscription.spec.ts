/**
 * Subscribing a calendar to a read-only iCalendar URL (#1261).
 *
 * The feed is one of the deployment's own secret addresses (#1067), so the
 * suite needs no third-party server: a calendar written here is published as a
 * feed, and a second calendar subscribes to it through the settings form.
 *
 * Every assertion that matters reads the API. The subscribed calendar has to
 * hold the feed's occurrences as the server expanded them, and it has to refuse
 * a write — a form that drew a success banner over a calendar the server never
 * filled, or one that accepted an edit the next refresh would silently undo,
 * both pass a DOM check.
 */
import { type CalendarEventInstance, waitFor } from "../src/api.js";
import { webFromStack } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };
test.use({ viewport: DESKTOP });

const WINDOW = {
	from: "2026-11-16T00:00:00+00:00",
	to: "2026-12-07T00:00:00+00:00",
};

const SERIES = "Lock-keeper handover";
const ALL_DAY = "Harbour closed for dredging";

const drawn = (items: CalendarEventInstance[], calendarId: string) =>
	items
		.filter((item) => item.calendarId === calendarId)
		.map((item) => ({
			summary: item.summary,
			startMs: Date.parse(item.start),
			endMs: Date.parse(item.end),
			allDay: item.allDay,
		}))
		.sort((left, right) => left.startMs - right.startMs);

test.describe("Subscribing to a calendar feed", () => {
	test("fills a read-only calendar from the feed and refuses writes to it", async ({
		page,
		api,
	}) => {
		const run = Date.now().toString(36);
		const source = await api.createCalendar({
			urlSegment: `ics-source-${run}`,
			displayName: `Harbour source ${run}`,
		});
		await api.createCalendarEvent({
			calendarId: source.calendarId,
			summary: SERIES,
			start: "2026-11-17T09:00:00+01:00",
			end: "2026-11-17T09:30:00+01:00",
			timeZone: "Europe/Amsterdam",
			recurrenceRule: "FREQ=WEEKLY;COUNT=3",
		});
		await api.createCalendarEvent({
			calendarId: source.calendarId,
			summary: ALL_DAY,
			start: "2026-11-20",
			end: "2026-11-21",
			allDay: true,
		});
		const published = drawn(
			await api.listCalendarEvents(WINDOW.from, WINDOW.to),
			source.calendarId,
		);
		expect(published).toHaveLength(4);

		const { feedToken } = await api.putCalendarFeed(source.calendarId);
		const address = `${webFromStack}/feeds/calendar/${feedToken}.ics`;
		const name = `Harbour rota ${run}`;

		await page.goto("/settings/calendars");
		const form = page.getByRole("region", { name: "Subscribe to a calendar" });
		await expect(form).toBeVisible({ timeout: 30_000 });
		await form.getByLabel("Calendar name").fill(name);
		await form.getByLabel("Calendar address").fill(address);
		await form.getByRole("button", { name: "Subscribe" }).click();

		const card = page.getByRole("region", { name });
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(form.getByRole("alert")).toHaveCount(0);
		await expect(card.getByText(/Read-only, from/)).toBeVisible();

		const subscribed = (await api.listCalendars()).find(
			(calendar) => calendar.displayName === name,
		);
		if (!subscribed) throw new Error(`"${name}" is not among the calendars`);
		expect(subscribed.source).toBe("Subscribed");
		expect(subscribed.subscriptionEnabled).toBe(true);
		expect(subscribed.subscriptionError).toBe("");
		expect(subscribed.subscriptionFetchedAt).toBeGreaterThan(0);

		const mirrored = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) => drawn(items, subscribed.calendarId).length === 4,
			{ what: "the feed's occurrences to reach the subscribed calendar" },
		);
		expect(drawn(mirrored, subscribed.calendarId)).toEqual(published);
		const [first] = mirrored.filter(
			(item) => item.calendarId === subscribed.calendarId,
		);
		if (!first) throw new Error("the subscribed calendar holds no occurrence");

		const added = await api.request("POST", "/calendar-events", {
			calendarId: subscribed.calendarId,
			summary: "Smuggled in",
			start: "2026-11-18T12:00:00+00:00",
			end: "2026-11-18T13:00:00+00:00",
		});
		expect(added.status).toBe(400);
		expect((await added.json()).code).toBe("read_only_calendar");

		const edited = await api.request(
			"PATCH",
			`/calendar-events/${first.calendarObjectId}?calendarId=${subscribed.calendarId}`,
			{ summary: "Renamed here" },
		);
		expect(edited.status).toBe(400);
		expect((await edited.json()).code).toBe("read_only_calendar");

		const removed = await api.deleteCalendarEvent(
			first.calendarObjectId,
			subscribed.calendarId,
		);
		expect(removed.status).toBe(400);
		expect((await removed.json()).code).toBe("read_only_calendar");

		expect(
			drawn(
				await api.listCalendarEvents(WINDOW.from, WINDOW.to),
				subscribed.calendarId,
			),
		).toEqual(published);

		await card.getByRole("button", { name: "Pause updates" }).click();
		await expect(
			card.getByRole("button", { name: "Resume updates" }),
		).toBeVisible();
		const paused = (await api.listCalendars()).find(
			(calendar) => calendar.calendarId === subscribed.calendarId,
		);
		expect(paused?.subscriptionEnabled).toBe(false);
		expect(
			drawn(
				await api.listCalendarEvents(WINDOW.from, WINDOW.to),
				subscribed.calendarId,
			),
		).toEqual(published);

		await api.deleteCalendar(subscribed.calendarId);
		await api.deleteCalendar(source.calendarId);
	});

	test("refuses an address that does not answer, and adds no calendar", async ({
		page,
		api,
	}) => {
		const name = `Unreachable ${Date.now().toString(36)}`;

		await page.goto("/settings/calendars");
		const form = page.getByRole("region", { name: "Subscribe to a calendar" });
		await expect(form).toBeVisible({ timeout: 30_000 });
		await form.getByLabel("Calendar name").fill(name);
		await form
			.getByLabel("Calendar address")
			.fill(`${webFromStack}/feeds/calendar/${"x".repeat(43)}.ics`);
		await form.getByRole("button", { name: "Subscribe" }).click();

		await expect(form.getByRole("alert")).toContainText(
			"The calendar was not added.",
		);
		await expect(form.getByRole("alert")).toContainText("HTTP 404");
		expect(
			(await api.listCalendars()).some(
				(calendar) => calendar.displayName === name,
			),
		).toBe(false);
	});
});
