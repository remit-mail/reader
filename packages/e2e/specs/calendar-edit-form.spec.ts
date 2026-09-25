/**
 * Writing and editing a one-off event through the form, proved against the
 * server (#1272).
 *
 * The form turns what it shows into a patch: which fields changed, on which
 * clock, spanning which days. None of that is visible in a grid that redraws
 * from its own cache, so every claim below is what `GET /calendar-events` and
 * the stored resource say — what the next client that asks will be served.
 */
import type {
	ApiClient,
	CalendarEventInstance,
	StoredCalendarEvent,
} from "../src/api.js";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

const DESKTOP = { width: 1512, height: 864 };
test.use({ viewport: DESKTOP, timezoneId: "UTC" });

const WEEK = "2032-09-06";
const WINDOW = {
	from: `${WEEK}T00:00:00+00:00`,
	to: "2032-09-20T00:00:00+00:00",
};

const weekPath = `/calendar/week/${WEEK}`;
const weekUrl = new RegExp(`/calendar/week/${WEEK}(\\?|#|$)`);

const clock = (iso: string): string => iso.slice(0, 16);
const day = (iso: string): string => iso.slice(0, 10);

const icalText = (stored: StoredCalendarEvent, name: string): string => {
	const unfolded = stored.icalData.replace(/\r?\n[ \t]/g, "");
	const line = unfolded
		.split(/\r?\n/)
		.find((candidate) => new RegExp(`^${name}[;:]`).test(candidate));
	if (!line) return "";
	return line
		.slice(line.indexOf(":") + 1)
		.replace(/\\n/gi, "\n")
		.replace(/\\,/g, ",")
		.replace(/\\;/g, ";")
		.replace(/\\\\/g, "\\");
};

const written: { calendarObjectId: string; calendarId: string }[] = [];
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

const defaultCalendarId = async (api: ApiClient): Promise<string> => {
	const calendars = await api.listCalendars();
	const calendarId = calendars[0]?.calendarId ?? "";
	expect(calendarId).not.toBe("");
	return calendarId;
};

const servedAs = async (
	api: ApiClient,
	summary: string,
): Promise<CalendarEventInstance> => {
	const items = await waitFor(
		() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
		(candidates) => candidates.some((item) => item.summary === summary),
		{ what: `"${summary}" to be served` },
	);
	const matching = items.filter((item) => item.summary === summary);
	expect(matching).toHaveLength(1);
	const [instance] = matching;
	if (!instance) throw new Error(`"${summary}" was never served`);
	return instance;
};

const occurrencesOf = async (
	api: ApiClient,
	calendarObjectId: string,
): Promise<CalendarEventInstance[]> =>
	(await api.listCalendarEvents(WINDOW.from, WINDOW.to)).filter(
		(item) => item.calendarObjectId === calendarObjectId,
	);

test.describe("Editing a one-off event through the form", () => {
	test("stores every field the form changed", async ({ page, api }) => {
		test.setTimeout(120_000);

		const before = "Harbour lease review";
		const after = "Harbour lease signing";
		const created = await api.createCalendarEvent({
			calendarId: await defaultCalendarId(api),
			summary: before,
			start: "2032-09-08T10:00:00+00:00",
			end: "2032-09-08T11:00:00+00:00",
			location: "Pier 4",
			description: "Bring the draft",
		});
		written.push(created);
		await servedAs(api, before);

		await page.goto(weekPath);
		await page.getByRole("button", { name: before }).first().click();
		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();

		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toHaveValue(before);
		await expect(page.getByLabel("Location", { exact: true })).toHaveValue(
			"Pier 4",
		);
		await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
			"Bring the draft",
		);

		await title.fill(after);
		await page.getByLabel("Date", { exact: true }).fill("2032-09-09");
		await page.getByLabel("Start time", { exact: true }).fill("13:00");
		await page.getByLabel("End time", { exact: true }).fill("14:30");
		await page.getByLabel("Location", { exact: true }).fill("Pier 7");
		await page
			.getByLabel("Notes", { exact: true })
			.fill("Bring the final copy");
		await page.getByRole("button", { name: "Save", exact: true }).click();

		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(title).toHaveCount(0, { timeout: 30_000 });

		const stored = await servedAs(api, after);
		expect(stored.calendarObjectId).toBe(created.calendarObjectId);
		expect(stored.allDay).toBe(false);
		expect(clock(stored.start)).toBe("2032-09-09T13:00");
		expect(clock(stored.end)).toBe("2032-09-09T14:30");
		expect(await occurrencesOf(api, created.calendarObjectId)).toHaveLength(1);

		const resource = await api.getCalendarEvent(
			created.calendarObjectId,
			created.calendarId,
		);
		expect(icalText(resource, "LOCATION")).toBe("Pier 7");
		expect(icalText(resource, "DESCRIPTION")).toBe("Bring the final copy");
	});

	test("writes an all-day event, then moves and renames it", async ({
		page,
		api,
	}) => {
		test.setTimeout(120_000);

		const before = "Quay inspection day";
		const after = "Quay inspection, rescheduled";

		await page.goto(`${weekPath}/new`);
		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toBeVisible({ timeout: 30_000 });
		await title.fill(before);
		await page.getByRole("checkbox", { name: "All day" }).check();
		await page.getByLabel("Date", { exact: true }).fill("2032-09-07");
		await page.getByRole("button", { name: "Add", exact: true }).click();

		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(page).toHaveURL(weekUrl, { timeout: 30_000 });

		const first = await servedAs(api, before);
		written.push(first);
		expect(first.allDay).toBe(true);
		expect(day(first.start)).toBe("2032-09-07");
		expect(day(first.end)).toBe("2032-09-08");

		await page.getByRole("button", { name: before }).first().click();
		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();

		await expect(title).toHaveValue(before);
		await expect(page.getByRole("checkbox", { name: "All day" })).toBeChecked();
		await title.fill(after);
		await page.getByLabel("Date", { exact: true }).fill("2032-09-10");
		await page.getByRole("button", { name: "Save", exact: true }).click();

		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(title).toHaveCount(0, { timeout: 30_000 });

		const moved = await servedAs(api, after);
		expect(moved.calendarObjectId).toBe(first.calendarObjectId);
		expect(moved.allDay).toBe(true);
		expect(day(moved.start)).toBe("2032-09-10");
		expect(day(moved.end)).toBe("2032-09-11");
		expect(await occurrencesOf(api, first.calendarObjectId)).toHaveLength(1);
	});

	test("moves an all-day event that spans days without losing any", async ({
		page,
		api,
	}) => {
		test.setTimeout(120_000);

		const summary = "Regatta weekend";
		const created = await api.createCalendarEvent({
			calendarId: await defaultCalendarId(api),
			summary,
			start: "2032-09-10",
			end: "2032-09-13",
			allDay: true,
		});
		written.push(created);
		const first = await servedAs(api, summary);
		expect(day(first.start)).toBe("2032-09-10");
		expect(day(first.end)).toBe("2032-09-13");

		await page.goto(weekPath);
		await page.getByRole("button", { name: summary }).first().click();
		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();

		await expect(page.getByLabel("End date", { exact: true })).toHaveValue(
			"2032-09-12",
		);
		await page.getByLabel("Date", { exact: true }).fill("2032-09-08");
		await expect(page.getByLabel("End date", { exact: true })).toHaveValue(
			"2032-09-10",
		);
		await page.getByRole("button", { name: "Save", exact: true }).click();

		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(page.getByRole("textbox", { name: "Title" })).toHaveCount(0, {
			timeout: 30_000,
		});

		const moved = await waitFor(
			() => api.listCalendarEvents(WINDOW.from, WINDOW.to),
			(items) =>
				items.some(
					(item) =>
						item.calendarObjectId === created.calendarObjectId &&
						day(item.start) === "2032-09-08",
				),
			{ what: `"${summary}" to move to Wednesday` },
		);
		const stored = moved.filter(
			(item) => item.calendarObjectId === created.calendarObjectId,
		);
		expect(stored).toHaveLength(1);
		expect(stored[0]?.allDay).toBe(true);
		expect(day(stored[0]?.start ?? "")).toBe("2032-09-08");
		expect(day(stored[0]?.end ?? "")).toBe("2032-09-11");
	});

	test("writes the days dragged across the all-day row", async ({
		page,
		api,
	}) => {
		test.setTimeout(120_000);

		const summary = "Harbour festival";
		await page.goto(weekPath);

		const monday = page
			.locator('.fc-timegrid [data-date="2032-09-06"]')
			.first();
		const wednesday = page
			.locator('.fc-timegrid [data-date="2032-09-08"]')
			.first();
		await expect(monday).toBeVisible({ timeout: 30_000 });
		const from = await monday.boundingBox();
		const to = await wednesday.boundingBox();
		if (!from || !to) throw new Error("the all-day row has no cells to drag");
		await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
		await page.mouse.down();
		await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
			steps: 10,
		});
		await page.mouse.up();

		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole("checkbox", { name: "All day" })).toBeChecked();
		await expect(page.getByLabel("Date", { exact: true })).toHaveValue(
			"2032-09-06",
		);
		await expect(page.getByLabel("End date", { exact: true })).toHaveValue(
			"2032-09-08",
		);
		await title.fill(summary);
		await page.getByRole("button", { name: "Add", exact: true }).click();

		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(title).toHaveCount(0, { timeout: 30_000 });

		const stored = await servedAs(api, summary);
		written.push(stored);
		expect(stored.allDay).toBe(true);
		expect(day(stored.start)).toBe("2032-09-06");
		expect(day(stored.end)).toBe("2032-09-09");
	});

	test("writes an event that runs past midnight, and edits it", async ({
		page,
		api,
	}) => {
		test.setTimeout(120_000);

		const before = "Night shift handover";
		const after = "Night shift handover, crew B";

		await page.goto(`${weekPath}/new`);
		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toBeVisible({ timeout: 30_000 });
		await title.fill(before);
		await page.getByLabel("Date", { exact: true }).fill("2032-09-08");
		await page.getByLabel("Start time", { exact: true }).fill("22:00");
		await page.getByLabel("End date", { exact: true }).fill("2032-09-09");
		await page.getByLabel("End time", { exact: true }).fill("01:00");
		await page.getByRole("button", { name: "Add", exact: true }).click();

		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(page).toHaveURL(weekUrl, { timeout: 30_000 });

		const first = await servedAs(api, before);
		written.push(first);
		expect(clock(first.start)).toBe("2032-09-08T22:00");
		expect(clock(first.end)).toBe("2032-09-09T01:00");

		await page.getByRole("button", { name: before }).first().click();
		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();

		await expect(title).toHaveValue(before);
		await expect(page.getByLabel("Date", { exact: true })).toHaveValue(
			"2032-09-08",
		);
		await expect(page.getByLabel("End date", { exact: true })).toHaveValue(
			"2032-09-09",
		);
		await expect(page.getByRole("alert")).toHaveCount(0);

		await title.fill(after);
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(title).toHaveCount(0, { timeout: 30_000 });

		const renamed = await servedAs(api, after);
		expect(renamed.calendarObjectId).toBe(first.calendarObjectId);
		expect(clock(renamed.start)).toBe("2032-09-08T22:00");
		expect(clock(renamed.end)).toBe("2032-09-09T01:00");
	});

	test("refuses an end before the start and saves nothing", async ({
		page,
		api,
	}) => {
		test.setTimeout(120_000);

		const summary = "Dry dock slot";
		const created = await api.createCalendarEvent({
			calendarId: await defaultCalendarId(api),
			summary,
			start: "2032-09-10T09:00:00+00:00",
			end: "2032-09-10T10:00:00+00:00",
		});
		written.push(created);
		const original = await api.getCalendarEvent(
			created.calendarObjectId,
			created.calendarId,
		);
		await servedAs(api, summary);

		await page.goto(weekPath);
		await page.getByRole("button", { name: summary }).first().click();
		const edit = page.getByRole("button", { name: "Edit", exact: true });
		await expect(edit).toBeVisible({ timeout: 30_000 });
		await edit.click();

		await page.getByLabel("Start time", { exact: true }).fill("15:00");

		await expect(page.getByRole("alert")).toContainText(
			"Ends before it starts",
		);
		await expect(
			page.getByRole("button", { name: "Save", exact: true }),
		).toBeDisabled();

		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(page.getByRole("textbox", { name: "Title" })).toHaveCount(0);

		const after = await api.getCalendarEvent(
			created.calendarObjectId,
			created.calendarId,
		);
		expect(after.etag).toBe(original.etag);
		const served = await servedAs(api, summary);
		expect(clock(served.start)).toBe("2032-09-10T09:00");
		expect(clock(served.end)).toBe("2032-09-10T10:00");
	});

	test("stores the event in the calendar the form picked", async ({
		page,
		api,
	}) => {
		test.setTimeout(120_000);

		const name = "Harbour side projects";
		const side = await api.createCalendar({
			urlSegment: "e2e-1272-harbour-side",
			displayName: name,
		});
		collections.push(side.calendarId);
		const summary = "Buoy repaint estimate";

		await page.goto(`${weekPath}/new`);
		const title = page.getByRole("textbox", { name: "Title" });
		await expect(title).toBeVisible({ timeout: 30_000 });
		await title.fill(summary);
		await page.getByLabel("Date", { exact: true }).fill("2032-09-09");
		await page.locator("label", { hasText: name }).click();
		await expect(page.getByRole("radio", { name })).toBeChecked();
		await page.getByRole("button", { name: "Add", exact: true }).click();

		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(page).toHaveURL(weekUrl, { timeout: 30_000 });

		const stored = await servedAs(api, summary);
		written.push(stored);
		expect(stored.calendarId).toBe(side.calendarId);
	});
});
