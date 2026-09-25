/**
 * Calendar collections managed from settings, the feed address replaced, and
 * clashes named where an event is read and edited (#1282).
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

const CLASH_WEEK = "2032-04-12";
const CLASH_DAY = "2032-04-14";
const CLASH_WINDOW = {
	from: `${CLASH_WEEK}T00:00:00+00:00`,
	to: "2032-04-19T00:00:00+00:00",
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

	test("the address filter and the editor picker follow each change", async ({
		page,
		api,
	}) => {
		test.setTimeout(120_000);
		const urlSegment = `quay${SEGMENT_SUFFIX}`;
		const inDefault = "Quay tide table";
		const inQuay = "Quay berth survey";

		await createFromSettings(page, {
			name: "Quay projects",
			urlSegment,
			timezone: "",
		});
		const quay = bySegment(
			await waitFor(
				() => api.listCalendars(),
				(calendars) => bySegment(calendars, urlSegment) !== undefined,
				{ what: "the new calendar to be listed" },
			),
			urlSegment,
		);
		if (!quay) throw new Error("the new calendar was never listed");
		const fallback = (await api.listCalendars()).find(
			(calendar) => calendar.source === "Default",
		);
		if (!fallback) throw new Error("the account holds no default calendar");

		written.push(
			await api.createCalendarEvent({
				calendarId: fallback.calendarId,
				summary: inDefault,
				start: "2032-03-10T09:00:00+00:00",
				end: "2032-03-10T10:00:00+00:00",
			}),
		);
		await api.createCalendarEvent({
			calendarId: quay.calendarId,
			summary: inQuay,
			start: "2032-03-10T13:00:00+00:00",
			end: "2032-03-10T14:00:00+00:00",
		});
		await waitFor(
			() => api.listCalendarEvents(FILTER_WINDOW.from, FILTER_WINDOW.to),
			(items) =>
				[inDefault, inQuay].every((summary) =>
					items.some((item) => item.summary === summary),
				),
			{ what: "both events to be expanded" },
		);

		const weekPath = `/calendar/week/${FILTER_WEEK}`;
		await page.goto(`${weekPath}?calendarId=${quay.calendarId}`);
		await expect(page.getByRole("button", { name: inQuay })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole("button", { name: inDefault })).toHaveCount(0);

		await page.goto(`${weekPath}/new`);
		await expect(
			page.getByRole("radio", { name: "Quay projects", exact: true }),
		).toBeAttached({ timeout: 30_000 });

		await page.goto("/settings/calendars");
		const card = calendarCard(page, "Quay projects");
		await card.getByLabel("Name", { exact: true }).fill("Quay works");
		await card.getByRole("button", { name: "Save changes" }).click();
		await expect(calendarCard(page, "Quay works")).toBeVisible({
			timeout: 30_000,
		});
		expect(bySegment(await api.listCalendars(), urlSegment)?.displayName).toBe(
			"Quay works",
		);

		await page.goto(`${weekPath}/new`);
		await expect(
			page.getByRole("radio", { name: "Quay works", exact: true }),
		).toBeAttached({ timeout: 30_000 });
		await expect(
			page.getByRole("radio", { name: "Quay projects", exact: true }),
		).toHaveCount(0);

		await page.goto("/settings/calendars");
		await expect(calendarCard(page, "Quay works")).toBeVisible({
			timeout: 30_000,
		});
		await deleteFromSettings(page, "Quay works");
		await expect(calendarCard(page, "Quay works")).toHaveCount(0, {
			timeout: 30_000,
		});
		expect(bySegment(await api.listCalendars(), urlSegment)).toBeUndefined();

		await page.goto(`${weekPath}?calendarId=${quay.calendarId}`);
		await expect(page.getByRole("button", { name: inDefault })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole("button", { name: inQuay })).toHaveCount(0);

		await page.goto(`${weekPath}/new`);
		await expect(
			page.getByRole("radio", { name: fallback.displayName, exact: true }),
		).toBeAttached({ timeout: 30_000 });
		await expect(
			page.getByRole("radio", { name: "Quay works", exact: true }),
		).toHaveCount(0);
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

test.describe("Clashes", () => {
	test("two overlapping events clash in the agenda and the editor; one in a free slot does not", async ({
		page,
		api,
	}) => {
		test.setTimeout(120_000);
		const calendars = await api.listCalendars();
		const fallback = calendars.find(
			(calendar) => calendar.source === "Default",
		);
		if (!fallback) throw new Error("the account holds no default calendar");

		const first = "Pilot boarding brief";
		const second = "Tug allocation call";
		const apart = "Berth inspection walk";
		const spans: [string, string, string][] = [
			[first, "10:00", "11:00"],
			[second, "10:30", "11:30"],
			[apart, "14:00", "15:00"],
		];
		for (const [summary, from, to] of spans) {
			written.push(
				await api.createCalendarEvent({
					calendarId: fallback.calendarId,
					summary,
					start: `${CLASH_DAY}T${from}:00+00:00`,
					end: `${CLASH_DAY}T${to}:00+00:00`,
				}),
			);
		}
		await waitFor(
			() => api.listCalendarEvents(CLASH_WINDOW.from, CLASH_WINDOW.to),
			(items) =>
				spans.every(([summary]) =>
					items.some((item) => item.summary === summary),
				),
			{ what: "all three events to be expanded" },
		);

		await page.goto(`/calendar/agenda/${CLASH_DAY}`);
		await expect(page.getByText(/\d+ at once/)).toHaveText(/^2 at once/, {
			timeout: 30_000,
		});
		await expect(page.getByText(/\d+ at once/)).toHaveCount(1);
		await expect(
			page.getByText("1 clash", { exact: false }).first(),
		).toBeVisible();

		const editorFor = async (summary: string) => {
			await page.goto(`/calendar/week/${CLASH_WEEK}`);
			await page.getByRole("button", { name: summary }).click({
				timeout: 30_000,
			});
			const edit = page.getByRole("button", { name: "Edit", exact: true });
			await expect(edit).toBeVisible({ timeout: 30_000 });
			await edit.click();
			await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
				summary,
			);
		};

		await editorFor(first);
		const clash = page.getByText(
			"This clashes with something you have already agreed to.",
		);
		await expect(clash).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText(`${second},`)).toBeVisible();
		await expect(page.getByText(`${apart},`)).toHaveCount(0);

		await editorFor(apart);
		await expect(
			page.getByText("Nothing else is booked at this time."),
		).toBeVisible({ timeout: 30_000 });
		await expect(clash).toHaveCount(0);
	});
});
