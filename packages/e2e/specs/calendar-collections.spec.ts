/**
 * Calendar collections managed from settings, and the feed address replaced
 * (#1282).
 *
 * Every claim is held against what the server answers — `GET /calendars`,
 * `GET /calendar-events` and a bare fetch of the feed — so a settings page or a
 * grid drawing its own cache back at itself cannot pass.
 */
import type { Page } from "@playwright/test";
import type { Calendar, CalendarEventResource } from "../src/api.js";
import { waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };
test.use({ viewport: DESKTOP, timezoneId: "UTC" });

const FILTER_WEEK = "2032-03-08";
const FILTER_WINDOW = {
	from: `${FILTER_WEEK}T00:00:00+00:00`,
	to: "2032-03-15T00:00:00+00:00",
};

const FEED_WINDOW = {
	from: "2032-05-10T00:00:00+00:00",
	to: "2032-05-17T00:00:00+00:00",
};

const SEGMENT_SUFFIX = "-c1282";

const written: CalendarEventResource[] = [];

test.afterEach(async ({ api }) => {
	while (written.length > 0) {
		const event = written.pop();
		if (event)
			await api.deleteCalendarEvent(event.calendarObjectId, event.calendarId);
	}
	const calendars = await api.listCalendars();
	for (const calendar of calendars) {
		if (calendar.urlSegment.endsWith(SEGMENT_SUFFIX))
			await api.deleteCalendar(calendar.calendarId);
	}
});

const dialable = (webcalUrl: string): string =>
	webcalUrl.replace(/^webcal:\/\//, "http://");

const calendarCard = (page: Page, name: string) =>
	page.getByRole("region", { name, exact: true });

const bySegment = (
	calendars: Calendar[],
	urlSegment: string,
): Calendar | undefined =>
	calendars.find((calendar) => calendar.urlSegment === urlSegment);

async function createFromSettings(
	page: Page,
	input: { name: string; urlSegment: string; timezone: string },
): Promise<void> {
	await page.goto("/settings/calendars");
	const form = page.getByRole("region", { name: "New calendar", exact: true });
	await expect(form).toBeVisible({ timeout: 30_000 });
	await form.getByLabel("Name", { exact: true }).fill(input.name);
	await form.getByLabel("Address", { exact: true }).fill(input.urlSegment);
	await form
		.getByLabel("Time zone", { exact: true })
		.selectOption(input.timezone);
	await form.getByRole("button", { name: "Add calendar" }).click();
	await expect(calendarCard(page, input.name)).toBeVisible({ timeout: 30_000 });
}

async function deleteFromSettings(page: Page, name: string): Promise<void> {
	await calendarCard(page, name)
		.getByRole("button", { name: "Delete calendar" })
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Delete calendar" })
		.click();
}

test.describe("Calendar collections in settings", () => {
	test("creates a calendar, renames it and sets its zone", async ({
		page,
		api,
	}) => {
		const urlSegment = `harbour${SEGMENT_SUFFIX}`;
		await createFromSettings(page, {
			name: "Harbour projects",
			urlSegment,
			timezone: "Europe/Amsterdam",
		});

		const created = await waitFor(
			() => api.listCalendars(),
			(calendars) => bySegment(calendars, urlSegment) !== undefined,
			{ what: "the new calendar to be listed" },
		);
		expect(bySegment(created, urlSegment)).toMatchObject({
			displayName: "Harbour projects",
			timezone: "Europe/Amsterdam",
		});

		const card = calendarCard(page, "Harbour projects");
		await card.getByLabel("Name", { exact: true }).fill("Harbour works");
		await card
			.getByLabel("Time zone", { exact: true })
			.selectOption("Europe/Lisbon");
		await card.getByRole("button", { name: "Save changes" }).click();
		await expect(calendarCard(page, "Harbour works")).toBeVisible({
			timeout: 30_000,
		});
		await expect(
			calendarCard(page, "Harbour works").getByRole("alert"),
		).toHaveCount(0);

		const renamed = await api.listCalendars();
		expect(bySegment(renamed, urlSegment)).toMatchObject({
			displayName: "Harbour works",
			timezone: "Europe/Lisbon",
		});
	});

	test("deletes an empty calendar, and shows why the default one stays", async ({
		page,
		api,
	}) => {
		const urlSegment = `scratch${SEGMENT_SUFFIX}`;
		await api.createCalendar({ urlSegment, displayName: "Scratch pad" });
		const calendars = await api.listCalendars();
		const fallback = calendars.find(
			(calendar) => calendar.source === "Default",
		);
		if (!fallback) throw new Error("the account holds no default calendar");

		await page.goto("/settings/calendars");
		await expect(calendarCard(page, "Scratch pad")).toBeVisible({
			timeout: 30_000,
		});
		await deleteFromSettings(page, "Scratch pad");
		await expect(calendarCard(page, "Scratch pad")).toHaveCount(0, {
			timeout: 30_000,
		});
		expect(bySegment(await api.listCalendars(), urlSegment)).toBeUndefined();

		await deleteFromSettings(page, fallback.displayName);
		await expect(
			calendarCard(page, fallback.displayName).getByRole("alert"),
		).toContainText("cannot be removed", { timeout: 30_000 });
		expect(
			(await api.listCalendars()).map((calendar) => calendar.calendarId),
		).toContain(fallback.calendarId);
	});

	test("asks before deleting a calendar with events, then takes them with it", async ({
		page,
		api,
	}) => {
		const urlSegment = `crew${SEGMENT_SUFFIX}`;
		const crew = await api.createCalendar({
			urlSegment,
			displayName: "Crew rota",
		});
		for (const day of ["2032-03-09", "2032-03-11"]) {
			await api.createCalendarEvent({
				calendarId: crew.calendarId,
				summary: `Crew change ${day}`,
				start: `${day}T08:00:00+00:00`,
				end: `${day}T09:00:00+00:00`,
			});
		}
		await waitFor(
			() => api.listCalendarEvents(FILTER_WINDOW.from, FILTER_WINDOW.to),
			(items) =>
				items.filter((item) => item.calendarId === crew.calendarId).length ===
				2,
			{ what: "both crew events to be expanded" },
		);

		await page.goto("/settings/calendars");
		const card = calendarCard(page, "Crew rota");
		await expect(card).toBeVisible({ timeout: 30_000 });

		await card.getByRole("button", { name: "Delete calendar" }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toContainText("every event in it");
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toHaveCount(0);
		expect(bySegment(await api.listCalendars(), urlSegment)).toBeDefined();

		await deleteFromSettings(page, "Crew rota");
		await expect(card).toHaveCount(0, { timeout: 30_000 });
		expect(bySegment(await api.listCalendars(), urlSegment)).toBeUndefined();
		const left = await api.listCalendarEvents(
			FILTER_WINDOW.from,
			FILTER_WINDOW.to,
		);
		expect(left.filter((item) => item.calendarId === crew.calendarId)).toEqual(
			[],
		);
	});

	test("replacing the feed address retires the old one and serves the same events", async ({
		page,
		api,
	}) => {
		const summary = "Ledger reconciliation";
		const ledger = await api.createCalendar({
			urlSegment: `ledger${SEGMENT_SUFFIX}`,
			displayName: "Rotation ledger",
		});
		await api.createCalendarEvent({
			calendarId: ledger.calendarId,
			summary,
			start: "2032-05-12T09:00:00+00:00",
			end: "2032-05-12T10:00:00+00:00",
		});
		await waitFor(
			() => api.listCalendarEvents(FEED_WINDOW.from, FEED_WINDOW.to),
			(items) => items.some((item) => item.summary === summary),
			{ what: `"${summary}" to reach the calendar` },
		);

		await page.goto("/settings/calendars");
		const card = calendarCard(page, "Rotation ledger");
		await card
			.getByRole("button", { name: "Create subscription address" })
			.click({ timeout: 30_000 });
		const address = card.getByLabel("Subscription address for Rotation ledger");
		await expect(address).toBeVisible({ timeout: 30_000 });
		const first = await address.inputValue();
		expect(first).toContain(new URL(baseUrl).host);

		const served = await fetch(dialable(first));
		expect(served.status).toBe(200);
		expect(await served.text()).toContain(summary);

		await card.getByRole("button", { name: "Replace address" }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Replace address" })
			.click();
		await expect(address).not.toHaveValue(first, { timeout: 30_000 });
		await expect(card.getByRole("alert")).toHaveCount(0);
		const second = await address.inputValue();
		expect(second).toMatch(/^webcal:\/\/.+\/feeds\/calendar\/.+\.ics$/);

		expect((await fetch(dialable(first))).status).toBe(404);
		const replaced = await fetch(dialable(second));
		expect(replaced.status).toBe(200);
		expect(await replaced.text()).toContain(summary);
	});
});
