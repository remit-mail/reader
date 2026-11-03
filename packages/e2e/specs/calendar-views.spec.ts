/**
 * Switching between the calendar's views and stepping through them. The view
 * and the date live in the path, so every assertion is on the address.
 */
import type { Page } from "@playwright/test";
import { CALENDAR_ZONE, today, weekDay } from "../src/calendar.js";
import { expect, test } from "../src/fixtures.js";

test.use({
	viewport: { width: 1440, height: 900 },
	timezoneId: CALENDAR_ZONE,
	locale: "en-GB",
});

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Calendar" });

test("a bare /calendar lands on this week", async ({ page }) => {
	await page.goto("/calendar");
	await expect(page).toHaveURL(new RegExp(`/calendar/week/${today()}$`));
	await expect(toolbar(page).getByText(/^Week \d+$/)).toBeVisible();
});

test("the view dropdown rewrites the path on the same date", async ({
	page,
}) => {
	await page.goto("/calendar/week/2026-06-10");
	for (const view of ["day", "month", "year", "agenda", "week"]) {
		await toolbar(page).getByLabel("View").selectOption(view);
		await expect(page).toHaveURL(new RegExp(`/calendar/${view}/2026-06-10`));
	}
});

test("the arrows step one unit of the view, Back and reload keep it, and Today returns", async ({
	page,
}) => {
	await page.goto(`/calendar/week/${weekDay(0)}`);
	const next = toolbar(page).getByRole("button", { name: "Next week" });
	await next.click();
	await expect(page).toHaveURL(new RegExp(`/calendar/week/${weekDay(7)}$`));
	await next.click();
	await expect(page).toHaveURL(new RegExp(`/calendar/week/${weekDay(14)}$`));
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/calendar/week/${weekDay(7)}$`));
	await page.reload();
	await expect(page).toHaveURL(new RegExp(`/calendar/week/${weekDay(7)}$`));

	await toolbar(page).getByLabel("View").selectOption("day");
	await toolbar(page).getByRole("button", { name: "Next day" }).click();
	await expect(page).toHaveURL(new RegExp(`/calendar/day/${weekDay(8)}$`));

	await toolbar(page).getByRole("button", { name: "Today" }).click();
	await expect(page).toHaveURL(new RegExp(`/calendar/day/${today()}$`));
});
