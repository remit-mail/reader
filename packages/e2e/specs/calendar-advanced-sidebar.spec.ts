/**
 * More options on quick-create opens the full editor beside the grid while the
 * draft stays drawn, and Save writes what the editor holds.
 */
import type { Page } from "@playwright/test";
import { waitFor } from "../src/api.js";
import {
	amsterdam,
	CALENDAR_ZONE,
	deleteEventsByPrefix,
	weekDay,
} from "../src/calendar.js";
import { dragRange } from "../src/calendar-grid.js";
import { expect, test } from "../src/fixtures.js";

test.use({
	viewport: { width: 1440, height: 900 },
	timezoneId: CALENDAR_ZONE,
	locale: "en-GB",
});

const PREFIX = "e2e sidebar";
const week = `/calendar/week/${weekDay(0)}`;
const quick = (page: Page) => page.getByRole("dialog", { name: "New event" });
const sidebar = (page: Page) => page.getByRole("form", { name: "New event" });
const block = (page: Page) => page.locator("[data-draft-block]");

const cleanUp = () => deleteEventsByPrefix(PREFIX);
test.afterAll(cleanUp);

const expand = async (page: Page, day: number): Promise<void> => {
	await page.goto(week);
	await dragRange(page, day, 14 * 60, 15 * 60 + 30);
	await quick(page).getByLabel("Title").fill("Carried title");
	await quick(page).getByLabel("Location").fill("Room 3");
	await quick(page).getByLabel("Location").focus();
	await quick(page).getByRole("button", { name: "More options" }).click();
};

test("More options opens the sidebar on the dashed draft and carries fields and focus", async ({
	page,
}) => {
	await expand(page, 3);
	await expect(sidebar(page)).toBeVisible();
	await expect(quick(page)).toHaveCount(0);
	await expect(sidebar(page).getByLabel("Title")).toHaveValue("Carried title");
	await expect(sidebar(page).getByLabel("Location")).toHaveValue("Room 3");
	await expect(sidebar(page).getByLabel("Location")).toBeFocused();
	await expect(block(page)).toContainText("Draft");
	await expect(block(page)).toHaveClass(/border-dashed/);
	await expect(page).toHaveURL(
		/\/new\?.*start=.*14%3A00%3A00.*end=.*15%3A45%3A00/,
	);
});

test("Save writes the draft, closes the sidebar and focuses the new event", async ({
	page,
	api,
}) => {
	await expand(page, 6);
	await sidebar(page).getByLabel("Title").fill(`${PREFIX} saved`);
	await sidebar(page).getByLabel("Description").fill("Bring numbers");
	await sidebar(page).getByRole("button", { name: "Save" }).click();
	await expect(sidebar(page)).toHaveCount(0);
	await expect(
		page.locator("[data-event-id]", { hasText: `${PREFIX} saved` }),
	).toBeFocused();
	await expect(page).toHaveURL(new RegExp(`${week}$`));

	const events = await waitFor(
		() =>
			api.listCalendarEvents(
				amsterdam(weekDay(6), "00:00"),
				amsterdam(weekDay(7), "00:00"),
			),
		(items) => items.some((item) => item.summary === `${PREFIX} saved`),
		{ what: "the event the sidebar saved on the server" },
	);
	const saved = events.find((item) => item.summary === `${PREFIX} saved`);
	expect(new Date(saved?.start ?? "").toISOString()).toBe(
		new Date(amsterdam(weekDay(6), "14:00")).toISOString(),
	);
	expect(new Date(saved?.end ?? "").toISOString()).toBe(
		new Date(amsterdam(weekDay(6), "15:45")).toISOString(),
	);
});

test("a touched draft asks before it is discarded", async ({ page }) => {
	await expand(page, 3);
	await sidebar(page).getByLabel("Description").fill("Bring numbers");
	await page.keyboard.press("Escape");
	const confirm = page.getByRole("dialog", { name: "Discard draft?" });
	await expect(confirm).toBeVisible();
	await confirm.getByRole("button", { name: "Keep editing" }).click();
	await expect(sidebar(page)).toBeVisible();
	await sidebar(page).getByRole("button", { name: "Close" }).click();
	await confirm.getByRole("button", { name: "Discard" }).click();
	await expect(sidebar(page)).toHaveCount(0);
	await expect(block(page)).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`${week}$`));
});
