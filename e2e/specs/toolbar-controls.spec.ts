/**
 * The reading-pane toolbar's control set is fixed (#52). Buttons do not enter
 * and leave the bar as the view or the selection changes; a button that cannot
 * act right now is disabled and still there.
 *
 * The daily brief is the view that regressed: it never rendered the (i) button
 * at all, so it is asserted here alongside a mailbox to show the two views
 * agree.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures.js";

const SHOW_INFO = "Show intelligence sidebar";
const HIDE_INFO = "Hide intelligence sidebar";

/**
 * Brief rows are buttons, not links — their accessible name is the sender,
 * subject and snippet the row renders. Addressing them by subject is what makes
 * a failure here mean "the row did not open" rather than "the selector was
 * written against markup that never existed".
 */
const openBriefMessage = async (page: Page, subject: string): Promise<void> => {
	const row = page.getByRole("button").filter({ hasText: subject }).first();
	await expect(row).toBeVisible({ timeout: 30_000 });
	await row.click();
	await page.waitForURL(/selectedMessageId=/);
};

const openInboxMessage = async (page: Page): Promise<void> => {
	const sidebar = page.getByRole("navigation", {
		name: "Mailboxes",
		exact: true,
	});
	await expect(sidebar).toBeVisible({ timeout: 20_000 });
	await sidebar.getByRole("link", { name: /inbox/i }).click();
	await page.waitForURL(/\/mail\/[a-z0-9]+/);
	const row = page.locator("a[href*='selectedMessageId']").first();
	await expect(row).toBeVisible({ timeout: 30_000 });
	await row.click();
	await page.waitForURL(/selectedMessageId=/);
};

test.describe("Reading-pane toolbar", () => {
	// Wide enough for the intelligence rail (≥1280px), so "disabled" means the
	// selection is missing rather than the window being too narrow.
	test.describe("wide enough for the rail", () => {
		test.use({ viewport: { width: 1440, height: 900 } });

		test("the daily brief offers the info button with nothing selected, disabled", async ({
			page,
		}) => {
			await page.goto("/mail");

			const info = page.getByRole("button", { name: SHOW_INFO });
			await expect(info).toBeVisible({ timeout: 20_000 });
			await expect(info).toBeDisabled();
		});

		test("opening a message from the daily brief enables the info button and its panel", async ({
			page,
			run,
		}) => {
			await page.goto("/mail");

			const info = page.getByRole("button", { name: SHOW_INFO });
			await expect(info).toBeVisible({ timeout: 20_000 });
			await expect(info).toBeDisabled();

			await openBriefMessage(page, run.seededSubjects[0]);

			await expect(info).toBeEnabled({ timeout: 15_000 });
			await info.click();

			await expect(page.getByRole("button", { name: HIDE_INFO })).toBeVisible();
			await expect(page.getByRole("complementary")).toBeVisible();
		});

		test("a mailbox offers the info button with nothing selected, disabled", async ({
			page,
		}) => {
			await page.goto("/mail");
			const sidebar = page.getByRole("navigation", {
				name: "Mailboxes",
				exact: true,
			});
			await expect(sidebar).toBeVisible({ timeout: 20_000 });
			await sidebar.getByRole("link", { name: /inbox/i }).click();
			await page.waitForURL(/\/mail\/[a-z0-9]+/);

			const info = page.getByRole("button", { name: SHOW_INFO });
			await expect(info).toBeVisible({ timeout: 20_000 });
			await expect(info).toBeDisabled();
		});
	});

	// 1024–1279: the reading pane is mounted but the rail is not. The toggle has
	// to read as inert here — disabled, and never in the pressed "Hide" state
	// pointing at a sidebar that cannot be on screen.
	test.describe("too narrow for the rail", () => {
		test.use({ viewport: { width: 1100, height: 900 } });

		test("an open message in the daily brief leaves the info button disabled and unpressed", async ({
			page,
			run,
		}) => {
			await page.goto("/mail");
			await openBriefMessage(page, run.seededSubjects[0]);

			const info = page.getByRole("button", { name: SHOW_INFO });
			await expect(info).toBeVisible({ timeout: 20_000 });
			await expect(info).toBeDisabled();
			await expect(info).toHaveAttribute("aria-pressed", "false");
			await expect(page.getByRole("button", { name: HIDE_INFO })).toHaveCount(
				0,
			);
		});

		test("an open message in a mailbox leaves the info button disabled and unpressed", async ({
			page,
		}) => {
			await page.goto("/mail");
			await openInboxMessage(page);

			const info = page.getByRole("button", { name: SHOW_INFO });
			await expect(info).toBeVisible({ timeout: 20_000 });
			await expect(info).toBeDisabled();
			await expect(info).toHaveAttribute("aria-pressed", "false");
			await expect(page.getByRole("button", { name: HIDE_INFO })).toHaveCount(
				0,
			);
		});
	});
});
